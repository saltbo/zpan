import { describe, expect, it } from 'vitest'
import { STREAM_RESPONSE_MAX_BYTES, streamResponseRange } from './stream'

describe('streamResponseRange', () => {
  it('answers a whole or open-ended request with at most one response worth', () => {
    expect(streamResponseRange(undefined, 1000)).toEqual({ start: 0, end: 999 })
    expect(streamResponseRange('bytes=10-', 1000)).toEqual({ start: 10, end: 999 })
    const size = STREAM_RESPONSE_MAX_BYTES * 3
    expect(streamResponseRange('bytes=0-', size)).toEqual({ start: 0, end: STREAM_RESPONSE_MAX_BYTES - 1 })
  })

  it('serves closed and suffix ranges, clamped to the file', () => {
    expect(streamResponseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(streamResponseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
    expect(streamResponseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('refuses ranges the file cannot serve', () => {
    expect(streamResponseRange('bytes=1000-', 1000)).toBeNull()
    expect(streamResponseRange('bytes=200-100', 1000)).toBeNull()
    expect(streamResponseRange('bytes=-', 1000)).toBeNull()
    expect(streamResponseRange('bytes=0-1,5-9', 1000)).toBeNull()
    expect(streamResponseRange('items=0-1', 1000)).toBeNull()
    expect(streamResponseRange(undefined, 0)).toBeNull()
  })
})

// ─── Chunks, purge and the read loop, against fake ports ─────────────────────

import { vi } from 'vitest'
import { parseTorrentInfo } from '../../domain/torrent-info'
import { buildTorrent, fileBytes } from '../../test/torrent-fixture'
import { S3ObjectNotFoundError, type TorrentRecord, type TorrentStreamChunkRecord } from '../ports'
import {
  generatorStream,
  purgeStreamChunks,
  putTaskStreamChunk,
  resolveStream,
  type StreamTarget,
  streamFileBytes,
  type TorrentStreamDeps,
} from './stream'

const fixture = buildTorrent('Show', [
  { path: 'E01.mkv', bytes: fileBytes(40_000, 1) },
  { path: 'E02.mkv', bytes: fileBytes(9_000, 2) },
])
const info = parseTorrentInfo(fixture.info)
const concat = Buffer.concat(fixture.files.map((file) => file.bytes))
const storage = {
  id: 's1',
  bucket: 'b',
  endpoint: 'e',
  region: 'r',
  accessKey: 'a',
  secretKey: 's',
  forcePathStyle: false,
}
const torrent = {
  id: 't1',
  infoHash: fixture.infoHash,
  storageId: 's1',
  status: 'downloading',
  sourceTaskId: 'task-1',
} as TorrentRecord
const file = { id: 'f1', torrentId: 't1', fileIdx: 0, path: 'E01.mkv', size: 40_000, objectKey: 'bt/x/f1' }

function fakeDeps(
  overrides: { status?: string[]; chunks?: TorrentStreamChunkRecord[]; objects?: Map<string, Uint8Array> } = {},
) {
  const statuses = [...(overrides.status ?? ['downloading'])]
  const objects = overrides.objects ?? new Map<string, Uint8Array>()
  objects.set(`bt/${fixture.infoHash}/info`, fixture.info)
  const chunks = overrides.chunks ?? []
  const deps = {
    torrents: {
      get: vi.fn(async () => {
        const status = statuses.length > 1 ? statuses.shift() : statuses[0]
        return status === 'gone' ? null : { ...torrent, status }
      }),
      findFile: vi.fn(async (id: string) => (id === file.id ? { torrent, file } : null)),
    },
    torrentStream: {
      findChunk: vi.fn(
        async (_t: string, piece: number) =>
          chunks.find((chunk) => chunk.firstPiece <= piece && piece < chunk.firstPiece + chunk.pieceCount) ?? null,
      ),
      want: vi.fn(async () => {}),
      insertChunk: vi.fn(async () => {}),
      purge: vi.fn(async () => chunks),
    },
    storages: { get: vi.fn(async (id: string) => (id === 's1' ? storage : null)) },
    s3: {
      getObjectBytes: vi.fn(async (_s: unknown, key: string) => objects.get(key) as Uint8Array),
      getObjectStream: vi.fn(async (_s: unknown, key: string, range: string) => {
        const bytes = objects.get(key)
        if (!bytes) throw new S3ObjectNotFoundError(key)
        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range) ?? []
        return new Response(bytes.slice(Number(from), Number(to) + 1)).body as ReadableStream<Uint8Array>
      }),
      putObject: vi.fn(async () => 0),
      evictTorrentObjects: vi.fn(async () => {}),
    },
    downloadTasks: {
      findRecord: vi.fn(async () => ({
        id: 'task-1',
        assignedDownloaderId: 'dl-1',
        torrentRole: 'fill',
        torrentId: 't1',
      })),
    },
    downloaders: { findRecord: vi.fn(async () => null) },
  }
  return { deps: deps as unknown as TorrentStreamDeps, raw: deps, objects }
}

async function collect(generator: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const part of generator) parts.push(part)
  return new Uint8Array(Buffer.concat(parts))
}

const target = (): StreamTarget => ({ torrent, file: file as never, storage, layout: { info, offset: 0 } })

describe('putTaskStreamChunk', () => {
  const put = (deps: TorrentStreamDeps, firstPiece: number, bytes: Uint8Array) =>
    putTaskStreamChunk(deps, { taskId: 'task-1', downloaderId: 'dl-1', firstPiece, bytes })

  it('stores whole matching pieces', async () => {
    const { deps, raw } = fakeDeps()
    expect(await put(deps, 1, concat.subarray(16_384, 3 * 16_384))).toEqual({ firstPiece: 1, pieceCount: 2 })
    expect(raw.torrentStream.insertChunk).toHaveBeenCalledWith(
      expect.objectContaining({ firstPiece: 1, pieceCount: 2, objectKey: `bt/${fixture.infoHash}/stream/1-2` }),
    )
  })

  it('refuses a piece out of range, an empty or oversized body, and a body past the end or off a piece', async () => {
    const { deps } = fakeDeps()
    await expect(put(deps, info.pieceCount, concat.subarray(0, 1))).rejects.toThrow('Piece is out of range')
    await expect(put(deps, 0, new Uint8Array())).rejects.toThrow('Chunk size is out of range')
    const pastTheEnd = Buffer.concat([concat.subarray(2 * 16_384), new Uint8Array(10)])
    await expect(put(deps, info.pieceCount - 1, pastTheEnd)).rejects.toThrow('Chunk runs past the torrent')
    await expect(put(deps, 0, concat.subarray(0, 100))).rejects.toThrow('Chunk does not end on a piece')
  })

  it('refuses a task of another downloader, and one without its storage', async () => {
    const { deps, raw } = fakeDeps()
    await expect(
      putTaskStreamChunk(deps, { taskId: 'task-1', downloaderId: 'other', firstPiece: 0, bytes: concat }),
    ).rejects.toThrow('Download task not found')
    raw.storages.get.mockResolvedValue(null)
    await expect(put(deps, 0, concat.subarray(0, 16_384))).rejects.toThrow('Torrent storage not found')
  })
})

describe('purgeStreamChunks', () => {
  const chunk = { torrentId: 't1', firstPiece: 0, pieceCount: 1, objectKey: 'bt/x/stream/0-1', size: 16_384 }

  it('leaves the objects to eviction when the storage is gone or the delete fails', async () => {
    const gone = fakeDeps({ chunks: [chunk] })
    gone.raw.storages.get.mockResolvedValue(null)
    await purgeStreamChunks(gone.deps, torrent)
    expect(gone.raw.s3.evictTorrentObjects).not.toHaveBeenCalled()

    const failing = fakeDeps({ chunks: [chunk] })
    failing.raw.s3.evictTorrentObjects.mockRejectedValue(new Error('boom'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await purgeStreamChunks(failing.deps, torrent)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('torrents.stream.purge_failed'))
    log.mockRestore()
  })
})

describe('resolveStream', () => {
  it('finds no stream for an unknown file or one the dictionary does not list', async () => {
    const { deps, raw } = fakeDeps()
    await expect(resolveStream(deps, { torrentFileId: 'nope' })).rejects.toThrow('Torrent file not found')
    raw.torrents.findFile.mockResolvedValue({ torrent, file: { ...file, fileIdx: 9 } } as never)
    await expect(resolveStream(deps, { torrentFileId: 'f1' })).rejects.toThrow('Torrent file not found')
  })
})

describe('streamFileBytes', () => {
  it('ends when the torrent is gone, or when a piece does not arrive in time', async () => {
    const gone = fakeDeps({ status: ['gone'] })
    await expect(collect(streamFileBytes(gone.deps, target(), { start: 0, end: 9 }))).rejects.toThrow(
      'no longer available',
    )
    const waiting = fakeDeps()
    await expect(
      collect(streamFileBytes(waiting.deps, target(), { start: 0, end: 9 }, { pollMs: 1, waitLimitMs: 5 })),
    ).rejects.toThrow('Piece 0 did not arrive')
  })

  it('reads on from the file when the chunk was purged because the torrent became ready', async () => {
    const chunk = { torrentId: 't1', firstPiece: 0, pieceCount: 1, objectKey: 'bt/x/stream/0-1', size: 16_384 }
    const { deps, objects } = fakeDeps({ status: ['downloading', 'ready'], chunks: [chunk] })
    objects.set(file.objectKey, fixture.files[0].bytes)
    expect(await collect(streamFileBytes(deps, target(), { start: 10, end: 19 }))).toEqual(
      fixture.files[0].bytes.slice(10, 20),
    )
  })

  it('fails on an object shorter than its range, and on a ready torrent without layout going back', async () => {
    const chunk = { torrentId: 't1', firstPiece: 0, pieceCount: 1, objectKey: 'bt/x/stream/0-1', size: 16_384 }
    const short = fakeDeps({ chunks: [chunk] })
    short.objects.set(chunk.objectKey, concat.subarray(0, 5))
    await expect(collect(streamFileBytes(short.deps, target(), { start: 0, end: 9 }))).rejects.toThrow('ended early')

    const { deps } = fakeDeps()
    await expect(collect(streamFileBytes(deps, { ...target(), layout: null }, { start: 0, end: 9 }))).rejects.toThrow(
      'no longer available',
    )
  })
})

describe('generatorStream', () => {
  it('errors the body when reading fails, and ends the generator when the body is canceled', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array([1])
      throw new Error('read failed')
    }
    await expect(new Response(generatorStream(failing())).arrayBuffer()).rejects.toThrow()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('torrents.stream.read_failed'))
    log.mockRestore()

    let finished = false
    async function* endless(): AsyncGenerator<Uint8Array> {
      try {
        for (;;) yield new Uint8Array([1])
      } finally {
        finished = true
      }
    }
    const reader = generatorStream(endless()).getReader()
    await reader.read()
    await reader.cancel()
    expect(finished).toBe(true)
  })
})
