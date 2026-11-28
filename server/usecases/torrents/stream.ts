// Streaming a torrent while it downloads (docs/design/torrents.md §14).
//
// The filling downloader uploads whole pieces ahead of the files, starting from
// the pieces players want. The server checks every piece against the info
// dictionary before it stores a chunk, so a stream only ever carries verified
// bytes and serves every workspace that holds the torrent, not only the one
// whose download fills it. A stream link reads a file's bytes from those chunks,
// waits for pieces that have not arrived, and once the torrent is ready reads
// its files.

import { parseTorrentInfo, pieceHash, pieceSize, type TorrentInfo, toHex } from '../../domain/torrent-info'
import { torrentInfoObjectKey, torrentObjectPrefix } from '../../domain/torrents'
import type { Deps } from '../deps'
import {
  badRequest,
  conflict,
  msg,
  notFound,
  S3ObjectNotFoundError,
  type S3StorageCredentials,
  type TorrentFileRecord,
  type TorrentRecord,
} from '../ports'
import { fillingTorrent } from './fill'

const MiB = 1024 * 1024

// Where stream links live; a stored link under it was issued while the
// torrent streamed.
export const STREAM_LINK_PATH = '/stremthru/stream/'

// The capability a downloader reports when it uploads pieces for streaming.
export const TORRENT_STREAM_CAPABILITY = 'torrent_stream'
// A chunk is at most this large, or one piece when a piece is larger; Workers
// take request bodies up to 100 MB.
export const STREAM_CHUNK_MAX_BYTES = 32 * MiB
const STREAM_CHUNK_BODY_LIMIT = 96 * MiB
// How far past a wanted piece the downloader uploads.
export const STREAM_READAHEAD_BYTES = 64 * MiB
// A want older than this is no longer anyone's position.
export const STREAM_WANT_TTL_MS = 2 * 60 * 1000
// One response carries at most this much; players ask for the next range.
export const STREAM_RESPONSE_MAX_BYTES = 32 * MiB
export const STREAM_POLL_INTERVAL_MS = 1500
// A response waiting this long for a piece gives up.
export const STREAM_WAIT_LIMIT_MS = 10 * 60 * 1000

const STREAMING_STATUSES = ['downloading', 'verifying']

export type TorrentStreamDeps = Pick<
  Deps,
  'torrents' | 'torrentStream' | 'storages' | 's3' | 'downloaders' | 'downloadTasks'
>

// ─── Which torrents stream ──────────────────────────────────────────────────

// A torrent streams before it is ready when its filling downloader uploads
// pieces for streaming. Once ready, its files play directly.
export async function canStream(
  deps: Pick<Deps, 'downloaders'>,
  torrent: TorrentRecord | null | undefined,
): Promise<boolean> {
  if (!torrent || !STREAMING_STATUSES.includes(torrent.status) || !torrent.sourceDownloaderId) return false
  const downloader = await deps.downloaders.findRecord(torrent.sourceDownloaderId)
  return !!downloader?.capabilities.includes(TORRENT_STREAM_CAPABILITY)
}

async function loadInfo(
  deps: Pick<Deps, 's3'>,
  storage: S3StorageCredentials,
  torrent: TorrentRecord,
): Promise<TorrentInfo> {
  return parseTorrentInfo(await deps.s3.getObjectBytes(storage, torrentInfoObjectKey(torrent.infoHash)))
}

async function storageOf(deps: Pick<Deps, 'storages'>, torrent: TorrentRecord) {
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent storage not found')
  return storage
}

export function streamChunkObjectKey(infoHash: string, firstPiece: number, pieceCount: number): string {
  return `${torrentObjectPrefix(infoHash)}stream/${firstPiece}-${pieceCount}`
}

// ─── The downloader's side ──────────────────────────────────────────────────

export interface TaskStreamState {
  pieceLength: number
  pieceCount: number
  readaheadBytes: number
  maxChunkBytes: number
  // Pieces players wait for or read from, ascending.
  wants: number[]
  // Chunks already stored.
  chunks: Array<{ firstPiece: number; pieceCount: number }>
}

async function streamingTorrentOf(
  deps: TorrentStreamDeps,
  taskId: string,
  downloaderId: string,
): Promise<TorrentRecord> {
  const task = await deps.downloadTasks.findRecord(taskId)
  if (!task || task.assignedDownloaderId !== downloaderId) throw notFound('Download task not found')
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) throw conflict('The task is not filling a torrent', 'TORRENT_NOT_FILLING')
  return torrent
}

// What the task's downloader should upload for streaming: the wanted pieces and
// the chunks already stored.
export async function getTaskStreamState(
  deps: TorrentStreamDeps,
  params: { taskId: string; downloaderId: string; now?: Date },
): Promise<TaskStreamState> {
  const torrent = await streamingTorrentOf(deps, params.taskId, params.downloaderId)
  const now = params.now ?? new Date()
  const info = await loadInfo(deps, await storageOf(deps, torrent), torrent)
  const [wants, chunks] = await Promise.all([
    deps.torrentStream.listWants(torrent.id, new Date(now.getTime() - STREAM_WANT_TTL_MS)),
    deps.torrentStream.listChunks(torrent.id),
  ])
  return {
    pieceLength: info.pieceLength,
    pieceCount: info.pieceCount,
    readaheadBytes: STREAM_READAHEAD_BYTES,
    maxChunkBytes: STREAM_CHUNK_MAX_BYTES,
    wants,
    chunks: chunks.map((chunk) => ({ firstPiece: chunk.firstPiece, pieceCount: chunk.pieceCount })),
  }
}

// Stores whole pieces from `firstPiece` on, after checking each against the
// info dictionary. The body must end on a piece boundary.
export async function putTaskStreamChunk(
  deps: TorrentStreamDeps,
  params: { taskId: string; downloaderId: string; firstPiece: number; bytes: Uint8Array; now?: Date },
): Promise<{ firstPiece: number; pieceCount: number }> {
  const torrent = await streamingTorrentOf(deps, params.taskId, params.downloaderId)
  const storage = await storageOf(deps, torrent)
  const info = await loadInfo(deps, storage, torrent)
  const { firstPiece, bytes } = params
  if (!Number.isInteger(firstPiece) || firstPiece < 0 || firstPiece >= info.pieceCount) {
    throw badRequest('Piece is out of range', 'TORRENT_PIECE_OUT_OF_RANGE')
  }
  if (bytes.length === 0 || bytes.length > Math.max(STREAM_CHUNK_BODY_LIMIT, info.pieceLength)) {
    throw badRequest('Chunk size is out of range', 'TORRENT_CHUNK_SIZE')
  }

  let offset = 0
  let piece = firstPiece
  while (offset < bytes.length) {
    if (piece >= info.pieceCount) throw badRequest('Chunk runs past the torrent', 'TORRENT_CHUNK_SIZE')
    const size = pieceSize(info, piece)
    if (offset + size > bytes.length) throw badRequest('Chunk does not end on a piece', 'TORRENT_CHUNK_SIZE')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes.slice(offset, offset + size)))
    if (toHex(digest) !== toHex(pieceHash(info, piece))) {
      console.error(
        `torrents.stream.piece_mismatch torrent=${torrent.id} piece=${piece} downloader=${params.downloaderId}`,
      )
      throw badRequest(msg('Piece {piece} does not match the torrent', { piece }), 'TORRENT_PIECE_MISMATCH')
    }
    offset += size
    piece++
  }

  const pieceCount = piece - firstPiece
  const objectKey = streamChunkObjectKey(torrent.infoHash, firstPiece, pieceCount)
  await deps.s3.putObject(storage, objectKey, bytes, 'application/octet-stream', bytes.length)
  await deps.torrentStream.insertChunk({
    torrentId: torrent.id,
    firstPiece,
    pieceCount,
    objectKey,
    size: bytes.length,
    now: params.now ?? new Date(),
  })
  return { firstPiece, pieceCount }
}

// The torrent is ready or will never stream again: its chunks go.
export async function purgeStreamChunks(
  deps: Pick<Deps, 'torrentStream' | 'storages' | 's3'>,
  torrent: Pick<TorrentRecord, 'id' | 'storageId'>,
): Promise<void> {
  const chunks = await deps.torrentStream.purge(torrent.id)
  if (chunks.length === 0) return
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) return
  try {
    await deps.s3.evictTorrentObjects(
      storage,
      chunks.map((chunk) => chunk.objectKey),
    )
  } catch (error) {
    // Eviction of the torrent lists and removes whatever is left under bt/.
    console.error(`torrents.stream.purge_failed torrent=${torrent.id} error=${(error as Error).message}`)
  }
}

// ─── The player's side ──────────────────────────────────────────────────────

export interface StreamTarget {
  torrent: TorrentRecord
  file: TorrentFileRecord
  storage: S3StorageCredentials
  // The piece layout, for a torrent that was not ready yet; a ready one is read
  // from its files alone.
  layout: { info: TorrentInfo; offset: number } | null
}

// What a stream link for a torrent file reads. A link stays on ZPan's origin
// for its lifetime, also once the torrent is ready, because a browser's media
// element refuses ranges of one resource that arrive from different origins,
// as a redirect to the bucket would make them.
export async function resolveStream(deps: TorrentStreamDeps, params: { torrentFileId: string }): Promise<StreamTarget> {
  const located = await deps.torrents.findFile(params.torrentFileId)
  if (!located) throw notFound('Torrent file not found')
  const { torrent, file } = located
  const storage = await storageOf(deps, torrent)
  if (torrent.status === 'ready') return { torrent, file, storage, layout: null }
  if (!STREAMING_STATUSES.includes(torrent.status)) throw notFound('Torrent file not found')
  const info = await loadInfo(deps, storage, torrent)
  const entry = info.files.find((item) => item.fileIdx === file.fileIdx)
  if (!entry) throw notFound('Torrent file not found')
  return { torrent, file, storage, layout: { info, offset: entry.offset } }
}

export interface ByteRange {
  start: number
  end: number
}

// The part of a requested range one response carries: a Range header the file
// can serve, capped so a response ends and the player asks for the next part.
// Null when the header cannot be served.
export function streamResponseRange(header: string | undefined, size: number): ByteRange | null {
  if (size === 0) return null
  let start = 0
  let end = size - 1
  if (header) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match || (match[1] === '' && match[2] === '')) return null
    if (match[1] === '') {
      start = Math.max(0, size - Number(match[2]))
    } else {
      start = Number(match[1])
      if (match[2] !== '') end = Math.min(end, Number(match[2]))
    }
    if (start > end || start >= size) return null
  }
  return { start, end: Math.min(end, start + STREAM_RESPONSE_MAX_BYTES - 1) }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function* readObject(
  deps: Pick<Deps, 's3'>,
  storage: S3StorageCredentials,
  key: string,
  start: number,
  end: number,
): AsyncGenerator<Uint8Array> {
  const stream = await deps.s3.getObjectStream(storage, key, `bytes=${start}-${end}`)
  const reader = stream.getReader()
  let left = end - start + 1
  try {
    while (left > 0) {
      const { done, value } = await reader.read()
      if (done) break
      const part = value.length > left ? value.subarray(0, left) : value
      left -= part.length
      yield part
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (left > 0) throw new Error(`Object ${key} ended early`)
}

// The file's bytes [range.start, range.end], read from the torrent's chunks as
// they arrive, or from its files once it is ready. A piece nobody uploaded yet
// is recorded as wanted and waited for.
export async function* streamFileBytes(
  deps: TorrentStreamDeps,
  target: StreamTarget,
  range: ByteRange,
  options: { pollMs?: number; waitLimitMs?: number } = {},
): AsyncGenerator<Uint8Array> {
  const pollMs = options.pollMs ?? STREAM_POLL_INTERVAL_MS
  const waitLimitMs = options.waitLimitMs ?? STREAM_WAIT_LIMIT_MS
  const { layout, file, storage } = target
  let position = range.start
  let waitingSince: number | null = null

  while (position <= range.end) {
    const torrent = await deps.torrents.get(target.torrent.id)
    if (!torrent || !['ready', ...STREAMING_STATUSES].includes(torrent.status)) {
      throw new Error('Torrent is no longer available')
    }
    if (torrent.status === 'ready') {
      yield* readObject(deps, storage, file.objectKey, position, range.end)
      return
    }
    if (!layout) throw new Error('Torrent is no longer available')
    const { info } = layout

    const global = layout.offset + position
    const piece = Math.floor(global / info.pieceLength)
    const chunk = await deps.torrentStream.findChunk(torrent.id, piece)
    await deps.torrentStream.want(torrent.id, piece, new Date())
    if (!chunk) {
      waitingSince ??= Date.now()
      if (Date.now() - waitingSince > waitLimitMs) throw new Error(`Piece ${piece} did not arrive`)
      await sleep(pollMs)
      continue
    }
    waitingSince = null

    const chunkStart = chunk.firstPiece * info.pieceLength
    const chunkEnd = chunkStart + chunk.size - 1
    const last = Math.min(chunkEnd, layout.offset + range.end)
    try {
      for await (const part of readObject(deps, storage, chunk.objectKey, global - chunkStart, last - chunkStart)) {
        position += part.length
        yield part
      }
    } catch (error) {
      // The torrent became ready and its chunks were purged meanwhile: the loop
      // reads on from its files.
      if (!(error instanceof S3ObjectNotFoundError)) throw error
    }
  }
}

// An async generator as a response body; canceling the body ends it.
export function generatorStream(generator: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await generator.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (error) {
        console.error(`torrents.stream.read_failed error=${(error as Error).message}`)
        controller.error(error)
      }
    },
    async cancel() {
      await generator.return(undefined)
    },
  })
}
