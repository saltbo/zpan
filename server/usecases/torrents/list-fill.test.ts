import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from '../deps'
import { ObjectUploadSessionError, type ObjectUploadSessionRecord, type TorrentEntryRecord } from '../ports'
import {
  abortFillUpload,
  completeFillUpload,
  createFillFile,
  createFillFolder,
  deleteFillEntry,
  type ListFill,
  listFillEntries,
  listFillFor,
  presignFillParts,
  setFillMedia,
} from './list-fill'

const now = new Date('2026-11-01T00:00:00Z')
const HASH = 'ab'.repeat(20)

let entries: TorrentEntryRecord[]
let sessions: Map<string, ObjectUploadSessionRecord>
let s3: Record<string, ReturnType<typeof vi.fn>>

function entry(overrides: Partial<TorrentEntryRecord>): TorrentEntryRecord {
  return {
    id: 'x',
    torrentId: 't1',
    kind: 'file',
    fileIdx: 0,
    path: 'Show/E01.mkv',
    layoutPath: 'Show/E01.mkv',
    size: 10,
    mime: 'video/x-matroska',
    storageId: 's1',
    objectKey: `bt/${HASH}/x`,
    media: null,
    uploadedAt: null,
    ...overrides,
  }
}

const task = {
  id: 'task-1',
  orgId: 'org',
  status: 'uploading',
  assignedDownloaderId: 'dl',
  torrentRole: 'fill',
  torrentId: 't1',
  listOnly: true,
  createdAt: now,
  updatedAt: now,
}
const torrent = { id: 't1', infoHash: HASH, storageId: 's1', status: 'downloading', sourceTaskId: 'task-1' }
const fill = { task, torrent, storage: { id: 's1' } } as unknown as ListFill

function deps(): Deps {
  return {
    torrents: {
      get: async () => torrent,
      listEntries: async () => entries.map((item) => ({ ...item })),
      listFiles: async () => entries.filter((item) => item.kind === 'file'),
      insertEntry: async (input: Partial<TorrentEntryRecord>) => {
        const made = entry({ ...input, fileIdx: null, path: null, uploadedAt: null })
        entries.push(made)
        return made
      },
      updateEntry: async (id: string, fields: Partial<TorrentEntryRecord>) => {
        entries = entries.map((item) => (item.id === id ? { ...item, ...fields } : item))
      },
      deleteEntry: async (id: string) => {
        entries = entries.filter((item) => item.id !== id)
      },
      findEntryByObject: async (_storage: string, key: string) =>
        entries.find((item) => item.objectKey === key) ?? null,
    },
    downloadTasks: { findRecord: async () => task },
    storages: { get: async () => ({ id: 's1' }) },
    s3,
    objectUploadSessions: {
      create: async (input: { objectId: string; storageKey: string; uploadId: string | null; partSize: number }) => {
        const record = {
          id: `session-${sessions.size + 1}`,
          status: 'active',
          expiresAt: new Date(Date.now() + 60_000),
          ...input,
        } as unknown as ObjectUploadSessionRecord
        sessions.set(record.id, record)
        return record
      },
      get: async (_org: string, objectId: string, id: string) => {
        const record = sessions.get(id)
        return record && record.objectId === objectId ? record : null
      },
      setStatus: async (id: string, status: 'completed' | 'aborted') => {
        const record = sessions.get(id)
        if (record) sessions.set(id, { ...record, status })
      },
    },
  } as unknown as Deps
}

beforeEach(() => {
  entries = [
    entry({ id: 'folder', kind: 'folder', fileIdx: null, path: null, layoutPath: 'Show', objectKey: null, size: 0 }),
    entry({ id: 'e01', objectKey: `bt/${HASH}/e01` }),
    entry({
      id: 'big',
      fileIdx: 1,
      path: 'Show/E02.mkv',
      layoutPath: 'Show/E02.mkv',
      size: 200 * 1024 * 1024,
      objectKey: `bt/${HASH}/big`,
    }),
    entry({
      id: 'nfo',
      kind: 'sidecar',
      fileIdx: null,
      path: null,
      layoutPath: 'Show/show.nfo',
      size: 3,
      objectKey: `bt/${HASH}/nfo`,
      uploadedAt: now,
    }),
  ]
  sessions = new Map()
  s3 = {
    presignUpload: vi.fn(async () => 'https://put'),
    presignUploadPart: vi.fn(async (_s, _k, _u, part) => `https://part/${part}`),
    createMultipartUpload: vi.fn(async () => 'mp-1'),
    completeMultipartUpload: vi.fn(async () => {}),
    abortMultipartUpload: vi.fn(async () => {}),
    headObject: vi.fn(async () => ({ size: 10, etag: 'etag' })),
  }
})

describe('list-only fill', () => {
  it('is null for a task that writes into the drive', async () => {
    const d = deps()
    ;(d.downloadTasks as unknown as { findRecord: () => unknown }).findRecord = async () => ({
      ...task,
      listOnly: false,
    })
    expect(await listFillFor(d, { taskId: 'task-1', downloaderId: 'dl' })).toBeNull()
  })

  it('lists live entries of a folder and finds one by name', async () => {
    const d = deps()
    expect((await listFillEntries(d, fill, { parent: 'Show', pageSize: 10 })).map((item) => item.name)).toEqual([
      'show.nfo',
    ])
    expect((await listFillEntries(d, fill, { parent: '', pageSize: 10 })).map((item) => item.id)).toEqual(['folder'])
    expect(await listFillEntries(d, fill, { parent: '/show/', name: 'SHOW.NFO', pageSize: 1 })).toEqual([
      expect.objectContaining({ id: 'nfo', dirtype: 0, status: 'active' }),
    ])
  })

  it('reuses a folder and refuses one where a file is', async () => {
    const d = deps()
    expect((await createFillFolder(d, fill, { parent: '', name: 'Show' })).id).toBe('folder')
    await expect(createFillFolder(d, fill, { parent: 'Show', name: 'show.nfo' })).rejects.toMatchObject({
      name: 'NameConflictError',
    })
  })

  it('renames, replaces, or refuses a sidecar at a taken name', async () => {
    const d = deps()
    const base = { parent: 'Show', size: 3, actorId: 'downloader:dl' }
    const renamed = await createFillFile(d, fill, { ...base, name: 'show.nfo', onConflict: 'rename' })
    expect(renamed.matter.name).toBe('show (1).nfo')
    await expect(createFillFile(d, fill, { ...base, name: 'show.nfo', onConflict: 'fail' })).rejects.toMatchObject({
      name: 'NameConflictError',
    })
    const replaced = await createFillFile(d, fill, { ...base, name: 'show.nfo', onConflict: 'replace' })
    expect(replaced.matter.name).toBe('show.nfo')
    expect(entries.some((item) => item.id === 'nfo')).toBe(false)
  })

  it('checks a file of the torrent against the info dictionary', async () => {
    const d = deps()
    const base = { parent: 'Show', name: 'E01.mkv', onConflict: 'fail' as const, actorId: 'a' }
    await expect(createFillFile(d, fill, { ...base, size: 10, torrentPath: 'missing' })).rejects.toMatchObject({
      httpStatus: 400,
    })
    await expect(createFillFile(d, fill, { ...base, size: 9, torrentPath: 'Show/E01.mkv' })).rejects.toMatchObject({
      httpStatus: 400,
    })
    await expect(
      createFillFile(d, fill, { ...base, size: 6 * 1024 ** 4, torrentPath: 'Show/E01.mkv' }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    entries = entries.map((item) => (item.id === 'e01' ? { ...item, uploadedAt: now } : item))
    await expect(
      createFillFile(d, fill, { ...base, name: 'E01b.mkv', size: 10, torrentPath: 'Show/E01.mkv' }),
    ).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('uploads a large file in parts, re-presigns, completes, and answers a retried completion', async () => {
    const d = deps()
    const created = await createFillFile(d, fill, {
      parent: 'Season 01',
      name: 'Show S01E02.mkv',
      size: 200 * 1024 * 1024,
      torrentPath: 'Show/E02.mkv',
      onConflict: 'fail',
      actorId: 'a',
    })
    expect(created.upload.mode).toBe('multipart')
    expect(entries.find((item) => item.id === 'big')?.layoutPath).toBe('Season 01/Show S01E02.mkv')
    const params = { objectId: 'big', sessionId: created.upload.sessionId }
    const parts = await presignFillParts(d, fill, { ...params, partNumbers: [2] })
    expect(parts.parts[0]).toMatchObject({ partNumber: 2, url: 'https://part/2', offset: 64 * 1024 * 1024 })
    await expect(presignFillParts(d, fill, { ...params, partNumbers: [1, 1] })).rejects.toBeInstanceOf(
      ObjectUploadSessionError,
    )
    await expect(presignFillParts(d, fill, { ...params, partNumbers: [9] })).rejects.toBeInstanceOf(
      ObjectUploadSessionError,
    )
    s3.headObject.mockResolvedValue({ size: 200 * 1024 * 1024, etag: 'whole' })
    const done = created.upload.parts.map((part) => ({ partNumber: part.partNumber, etag: `e${part.partNumber}` }))
    const live = await completeFillUpload(d, fill, { ...params, parts: done })
    expect(live.status).toBe('active')
    expect(s3.completeMultipartUpload).toHaveBeenCalledTimes(1)
    expect((await completeFillUpload(d, fill, { ...params, parts: done })).id).toBe('big')
    await expect(presignFillParts(d, fill, { ...params, partNumbers: [1] })).rejects.toBeInstanceOf(
      ObjectUploadSessionError,
    )
    await expect(abortFillUpload(d, fill, params)).rejects.toBeInstanceOf(ObjectUploadSessionError)
  })

  it('refuses a completion whose bytes did not land or do not match', async () => {
    const d = deps()
    const created = await createFillFile(d, fill, {
      parent: 'Show',
      name: 'E01.mkv',
      size: 10,
      torrentPath: 'Show/E01.mkv',
      onConflict: 'fail',
      actorId: 'a',
    })
    const params = { objectId: 'e01', sessionId: created.upload.sessionId }
    s3.headObject.mockRejectedValueOnce(new Error('NotFound'))
    await expect(
      completeFillUpload(d, fill, { ...params, parts: [{ partNumber: 1, etag: 'etag' }] }),
    ).rejects.toMatchObject({
      reason: 'object_not_found',
    })
    await expect(
      completeFillUpload(d, fill, { ...params, parts: [{ partNumber: 1, etag: 'other' }] }),
    ).rejects.toMatchObject({
      reason: 'etag_mismatch',
    })
    await expect(
      completeFillUpload(d, fill, { objectId: 'nfo', sessionId: params.sessionId, parts: [] }),
    ).rejects.toBeInstanceOf(ObjectUploadSessionError)
    await expect(completeFillUpload(d, fill, { objectId: 'folder', sessionId: 'x', parts: [] })).rejects.toMatchObject({
      httpStatus: 403,
    })
  })

  it('reports a storage failure while completing or aborting parts', async () => {
    const d = deps()
    const created = await createFillFile(d, fill, {
      parent: 'Show',
      name: 'E02.mkv',
      size: 200 * 1024 * 1024,
      torrentPath: 'Show/E02.mkv',
      onConflict: 'fail',
      actorId: 'a',
    })
    const params = { objectId: 'big', sessionId: created.upload.sessionId }
    const done = created.upload.parts.map((part) => ({ partNumber: part.partNumber, etag: 'e' }))
    s3.completeMultipartUpload.mockRejectedValueOnce(new Error('boom'))
    await expect(completeFillUpload(d, fill, { ...params, parts: done })).rejects.toMatchObject({
      code: 'storage_failure',
    })
    s3.abortMultipartUpload.mockRejectedValueOnce(new Error('boom'))
    await expect(abortFillUpload(d, fill, params)).rejects.toMatchObject({ code: 'storage_failure' })
    await abortFillUpload(d, fill, params)
    expect(s3.abortMultipartUpload).toHaveBeenCalledTimes(2)
    await abortFillUpload(d, fill, params)
    expect(s3.abortMultipartUpload).toHaveBeenCalledTimes(2)
  })

  it('cleans up entries the downloader deletes', async () => {
    const d = deps()
    await deleteFillEntry(d, fill, 'folder')
    await deleteFillEntry(d, fill, 'nfo')
    entries = entries.map((item) => (item.id === 'e01' ? { ...item, uploadedAt: now } : item))
    await deleteFillEntry(d, fill, 'e01')
    expect(entries.map((item) => [item.id, item.uploadedAt])).toEqual([
      ['folder', null],
      ['e01', null],
      ['big', null],
    ])
    await expect(deleteFillEntry(d, fill, 'missing')).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('keeps media images that are uploaded sidecars of the torrent', async () => {
    const d = deps()
    entries = entries.map((item) => (item.id === 'e01' ? { ...item, uploadedAt: now } : item))
    await setFillMedia(d, fill, {
      objectId: 'folder',
      media: { kind: 'tvshow', tmdb: { id: 1, type: 'tv' }, title: 'Show', poster: 'nfo', fanart: 'elsewhere' },
    } as never)
    expect(entries.find((item) => item.id === 'folder')?.media).toMatchObject({ poster: 'nfo' })
    expect(entries.find((item) => item.id === 'folder')?.media).not.toHaveProperty('fanart')
    await expect(
      setFillMedia(d, fill, { objectId: 'folder', media: { kind: 'movie', tmdb: { id: 1, type: 'movie' } } as never }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    await expect(
      setFillMedia(d, fill, { objectId: 'big', media: { kind: 'movie', tmdb: { id: 1, type: 'movie' } } as never }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})
