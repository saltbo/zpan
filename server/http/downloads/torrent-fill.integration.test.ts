import { createHash } from 'node:crypto'
import type { DownloadTask, DownloadTaskTimelineItem } from '@shared/types'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../../adapters/gateways/s3.js'
import { encodeBencode } from '../../domain/bencode.js'
import { authedHeaders, createTestApp, seedProLicense } from '../../test/setup.js'
import { buildTorrent, fileBytes, type TorrentFixture } from '../../test/torrent-fixture.js'
import { createDownloader } from '../../usecases/downloads/downloads.js'
import { S3ObjectNotFoundError } from '../../usecases/ports.js'
import { TORRENT_EVICTING_MESSAGE } from '../../usecases/torrents/entries.js'
import { ABANDONED_FILL_GRACE_MS, evictTorrents } from '../../usecases/torrents/eviction.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'torrent-storage'

// An in-memory bucket behind the S3 gateway: presigned URLs name the key, and the
// test "uploads" by writing the bytes for that URL.
let objects: Map<string, Uint8Array>
let multipart: Map<string, Map<number, Uint8Array>>

function installMemoryS3() {
  objects = new Map()
  multipart = new Map()
  vi.spyOn(S3Service.prototype, 'presignUpload').mockImplementation(async (_s, key) => `mem://put/${key}`)
  vi.spyOn(S3Service.prototype, 'createMultipartUpload').mockImplementation(async (_s, key) => {
    multipart.set(`mp:${key}`, new Map())
    return `mp:${key}`
  })
  vi.spyOn(S3Service.prototype, 'presignUploadPart').mockImplementation(
    async (_s, _key, uploadId, part) => `mem://part/${encodeURIComponent(uploadId)}/${part}`,
  )
  vi.spyOn(S3Service.prototype, 'completeMultipartUpload').mockImplementation(async (_s, key, uploadId, parts) => {
    const staged = multipart.get(uploadId)
    if (!staged) throw new Error('NoSuchUpload')
    const chunks = parts.map((part) => staged.get(part.partNumber) ?? new Uint8Array())
    objects.set(key, Buffer.concat(chunks))
  })
  vi.spyOn(S3Service.prototype, 'headObject').mockImplementation(async (_s, key) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error('NotFound')
    return { size: bytes.length, etag: 'etag' }
  })
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_s, key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    objects.set(key, bytes)
    return bytes.length
  })
  vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_s, key) => {
    const bytes = objects.get(key)
    if (!bytes) throw new S3ObjectNotFoundError(key)
    return bytes
  })
  vi.spyOn(S3Service.prototype, 'listTorrentKeys').mockImplementation(async (_s, prefix) =>
    [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
  )
  vi.spyOn(S3Service.prototype, 'evictTorrentObjects').mockImplementation(async (_s, keys) => {
    for (const key of keys) objects.delete(key)
  })
  vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(async (_s, key, range) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error('NoSuchKey')
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '') ?? []
    const slice = range ? bytes.slice(Number(from), Number(to) + 1) : bytes.slice()
    return new Response(slice).body as ReadableStream<Uint8Array>
  })
}

function upload(url: string, bytes: Uint8Array) {
  const put = /^mem:\/\/put\/(.+)$/.exec(url)
  if (put) {
    objects.set(put[1], bytes)
    return
  }
  const part = /^mem:\/\/part\/([^/]+)\/(\d+)$/.exec(url)
  if (!part) throw new Error(`unknown upload url ${url}`)
  multipart.get(decodeURIComponent(part[1]))?.set(Number(part[2]), bytes)
}

beforeEach(() => {
  vi.restoreAllMocks()
  installMemoryS3()
})

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function workspace(app: TestApp['app'], db: TestApp['db'], email: string) {
  const headers = { ...(await authedHeaders(app, email)), 'Content-Type': 'application/json' }
  const [row] = await db.all<{ orgId: string; userId: string }>(sql`
    SELECT o.id AS orgId, u.id AS userId FROM organization o
    JOIN member m ON m.organization_id = o.id
    JOIN user u ON u.id = m.user_id
    WHERE u.email = ${email} AND o.metadata LIKE '%"type":"personal"%'
  `)
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quota_entitlements SET status = 'revoked'
    WHERE org_id = ${row.orgId} AND resource_type = 'storage' AND entitlement_type = 'plan'
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${`plan-${row.orgId}`}, ${row.orgId}, 'storage', 'plan', 'test', ${`plan:${row.orgId}`}, 100000000, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
  return { headers, ...row }
}

const heartbeat = {
  version: 'test-1.0.0',
  hostname: 'torrent-downloader',
  platform: 'linux',
  arch: 'amd64',
  engine: 'qbittorrent' as const,
  capabilities: ['magnet', 'torrent'],
  maxConcurrentTasks: 4,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024 ** 3,
}

interface Downloader {
  headers: Record<string, string>
  poll: () => Promise<DownloadTask[]>
}

async function downloader(ctx: TestApp, ownerId: string, capabilities = ['magnet', 'torrent']): Promise<Downloader> {
  const created = await createDownloader(
    ctx.deps,
    ctx.platform,
    { name: `dl-${capabilities.join('-')}`, heartbeat: { ...heartbeat, capabilities } },
    ownerId,
  )
  const headers = bearer(created.token)
  const poll = async () => {
    const res = await ctx.app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...heartbeat, capabilities }),
    })
    expect(res.status).toBe(200)
    return ((await res.json()) as { assignments: DownloadTask[] }).assignments
  }
  return { headers, poll }
}

async function submit(
  app: TestApp['app'],
  headers: Record<string, string>,
  magnet: string,
  targetFolder = 'Downloads',
) {
  const res = await app.request('/api/downloads/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: { type: 'magnet', uri: magnet }, targetFolder }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as DownloadTask
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// Reports the task's info dictionary on the task, as a downloader does once
// its engine has the torrent's metadata.
async function reportInfo(app: TestApp['app'], dl: Downloader, task: DownloadTask, info: string) {
  const res = await app.request(`/api/downloads/tasks/${task.id}`, {
    method: 'PATCH',
    headers: dl.headers,
    body: JSON.stringify({ torrentInfo: info }),
  })
  return { status: res.status, body: (await res.json()) as DownloadTask & { error?: { details?: unknown } } }
}

function token(task: DownloadTask) {
  return bearer(task.status.assignment?.uploadToken as string)
}

async function createFolder(app: TestApp['app'], task: DownloadTask, parent: string, name: string) {
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: token(task),
    body: JSON.stringify({ name, type: 'folder', parent, dirtype: 1, onConflict: 'fail' }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

interface Draft {
  id: string
  upload: { sessionId: string; parts: Array<{ partNumber: number; url: string; offset: number; length: number }> }
}

// Creates one file's draft through the object API under the task's upload token.
async function createDraft(
  app: TestApp['app'],
  task: DownloadTask,
  file: { parent: string; name: string; bytes: Uint8Array; torrentPath?: string },
) {
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: token(task),
    body: JSON.stringify({
      name: file.name,
      type: 'application/octet-stream',
      size: file.bytes.length,
      parent: file.parent,
      dirtype: 0,
      onConflict: 'rename',
      ...(file.torrentPath ? { torrentPath: file.torrentPath } : {}),
    }),
  })
  if (res.status !== 201) return { status: res.status, body: await res.json() }
  return { status: 201, draft: (await res.json()) as Draft }
}

// Uploads a draft's bytes and completes it.
async function finishDraft(app: TestApp['app'], task: DownloadTask, draft: Draft, bytes: Uint8Array) {
  for (const part of draft.upload.parts) upload(part.url, bytes.subarray(part.offset, part.offset + part.length))
  const done = await app.request(`/api/objects/${draft.id}/uploads/${draft.upload.sessionId}/completions`, {
    method: 'POST',
    headers: token(task),
    body: JSON.stringify({ parts: draft.upload.parts.map((part) => ({ partNumber: part.partNumber, etag: 'etag' })) }),
  })
  expect(done.status).toBe(200)
}

// Uploads one file through the object API under the task's upload token.
async function uploadFile(
  app: TestApp['app'],
  task: DownloadTask,
  file: { parent: string; name: string; bytes: Uint8Array; torrentPath?: string },
) {
  const created = await createDraft(app, task, file)
  if (!created.draft) return { status: created.status, body: created.body }
  await finishDraft(app, task, created.draft, file.bytes)
  return { status: 201, id: created.draft.id }
}

async function putMedia(app: TestApp['app'], task: DownloadTask, id: string, media: unknown) {
  const res = await app.request(`/api/objects/${id}/metadata/media`, {
    method: 'PUT',
    headers: token(task),
    body: JSON.stringify(media),
  })
  expect(res.status).toBe(200)
}

async function completeTask(app: TestApp['app'], dl: Downloader, task: DownloadTask, resultObjectId: string) {
  const res = await app.request(`/api/downloads/tasks/${task.id}`, {
    method: 'PATCH',
    headers: dl.headers,
    body: JSON.stringify({ status: 'completed', resultObjectId }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as DownloadTask
}

// Acts as a downloader without scraping: reports the info dictionary, then
// uploads the torrent's own tree through the object API, each file with its
// torrentPath, and completes the task.
async function fillTorrent(app: TestApp['app'], dl: Downloader, task: DownloadTask, torrent: TorrentFixture) {
  return completeTask(app, dl, task, await uploadTorrentTree(app, dl, task, torrent))
}

// Reports the info dictionary and uploads the torrent's own tree; returns the
// root folder's id.
async function uploadTorrentTree(app: TestApp['app'], dl: Downloader, task: DownloadTask, torrent: TorrentFixture) {
  const reported = await reportInfo(app, dl, task, torrent.infoBase64)
  expect(reported.status).toBe(200)
  const folder = task.spec.destination.folder
  const root = await createFolder(app, task, folder, torrent.name)
  const made = new Set<string>()
  for (const file of torrent.files.filter((item) => !item.padding)) {
    const segments = file.path.split('/')
    let parent = `${folder}/${torrent.name}`
    for (const segment of segments.slice(0, -1)) {
      if (!made.has(`${parent}/${segment}`)) {
        await createFolder(app, task, parent, segment)
        made.add(`${parent}/${segment}`)
      }
      parent = `${parent}/${segment}`
    }
    const uploaded = await uploadFile(app, task, {
      parent,
      name: segments.at(-1) as string,
      bytes: file.bytes,
      torrentPath: file.path,
    })
    expect(uploaded.status).toBe(201)
  }
  return root
}

async function entries(db: TestApp['db'], infoHash: string) {
  return db.all<{
    id: string
    kind: string
    fileIdx: number | null
    path: string | null
    layoutPath: string
    size: number
    objectKey: string | null
    media: string | null
    uploaded: number
  }>(sql`
    SELECT f.id, f.kind, f.file_idx AS fileIdx, f.path, f.layout_path AS layoutPath, f.size,
      f.object_key AS objectKey, f.media, f.uploaded_at IS NOT NULL AS uploaded
    FROM torrent_files f JOIN torrents t ON t.id = f.torrent_id
    WHERE t.info_hash = ${infoHash}
    ORDER BY f.layout_path
  `)
}

// The object key of each file entry of a torrent, by file index.
async function fileKeys(db: TestApp['db'], infoHash: string): Promise<Record<number, string>> {
  const rows = await db.all<{ fileIdx: number; objectKey: string }>(sql`
    SELECT f.file_idx AS fileIdx, f.object_key AS objectKey FROM torrent_files f
    JOIN torrents t ON t.id = f.torrent_id
    WHERE t.info_hash = ${infoHash} AND f.kind = 'file'
  `)
  return Object.fromEntries(rows.map((row) => [row.fileIdx, row.objectKey]))
}

async function torrentStatus(db: TestApp['db'], infoHash: string) {
  const [row] = await db.all<{ id: string; status: string; verified: string | null }>(sql`
    SELECT id, status, verified FROM torrents WHERE info_hash = ${infoHash}
  `)
  return row
}

async function waitForTorrent(db: TestApp['db'], infoHash: string, status: string) {
  for (let i = 0; i < 100; i++) {
    const row = await torrentStatus(db, infoHash)
    if (row?.status === status) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`torrent ${infoHash} never became ${status}`)
}

async function driveFiles(db: TestApp['db'], orgId: string) {
  return db.all<{ name: string; parent: string; object: string; size: number }>(sql`
    SELECT name, parent, object, size FROM matters
    WHERE org_id = ${orgId} AND dirtype = 0 AND purged_at IS NULL
    ORDER BY parent, name
  `)
}

async function getTask(app: TestApp['app'], headers: Record<string, string>, id: string) {
  const res = await app.request(`/api/downloads/tasks/${id}`, { headers })
  expect(res.status).toBe(200)
  return (await res.json()) as DownloadTask
}

async function timeline(app: TestApp['app'], headers: Record<string, string>, id: string) {
  const res = await app.request(`/api/downloads/tasks/${id}/events`, { headers })
  expect(res.status).toBe(200)
  return ((await res.json()) as { items: DownloadTaskTimelineItem[] }).items
}

function sampleTorrent(name = 'Sample Show') {
  return buildTorrent(name, [
    { path: 'Season 01/E01.mkv', bytes: fileBytes(70_000, 1) },
    { path: '.pad/11920', bytes: new Uint8Array(11_920), padding: true },
    { path: 'Season 01/E02.mkv', bytes: fileBytes(33_000, 2) },
  ])
}

async function setup(env: Record<string, string> = {}) {
  const ctx = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret', ...env })
  await seedStorage(ctx.db)
  await seedProLicense(ctx.db)
  const a = await workspace(ctx.app, ctx.db, 'fill-a@example.com')
  const b = await workspace(ctx.app, ctx.db, 'fill-b@example.com')
  return { ctx, a, b }
}

async function submitTorrentUrl(app: TestApp['app'], headers: Record<string, string>) {
  const res = await app.request('/api/downloads/tasks', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: { type: 'torrent_url', uri: 'https://example.com/show.torrent' },
      targetFolder: 'Downloads',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as DownloadTask
}

async function readyTorrent(ctx: TestApp, a: { headers: Record<string, string> }, dl: Downloader) {
  const torrent = sampleTorrent()
  await submit(ctx.app, a.headers, torrent.magnet)
  await fillTorrent(ctx.app, dl, (await dl.poll())[0], torrent)
  await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
  return torrent
}

async function matterMedia(db: TestApp['db'], orgId: string, name: string) {
  const [row] = await db.all<{ id: string; metadata: string | null }>(sql`
    SELECT id, metadata FROM matters WHERE org_id = ${orgId} AND name = ${name} AND purged_at IS NULL
  `)
  return { id: row?.id, media: row?.metadata ? (JSON.parse(row.metadata) as { media?: unknown }).media : undefined }
}

describe('torrent fill through the object API', () => {
  it('stores a fill task’s uploads under bt/ and its drive files reference them [spec: torrents/fill-from-download]', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    const submitted = await submit(ctx.app, a.headers, torrent.magnet)

    const [assigned] = await dl.poll()
    expect(assigned.id).toBe(submitted.id)
    const completed = await fillTorrent(ctx.app, dl, assigned, torrent)
    expect(completed.status.state).toBe('completed')

    // Stored under bt/<infoHash>/: the info dictionary and every non-padding file.
    expect(objects.get(`bt/${torrent.infoHash}/info`)).toEqual(torrent.info)
    const keys = await fileKeys(ctx.db, torrent.infoHash)
    expect(Object.keys(keys)).toEqual(['0', '2'])
    expect([...objects.keys()].filter((key) => key.startsWith('bt/')).sort()).toEqual(
      [keys[0], keys[2], `bt/${torrent.infoHash}/info`].sort(),
    )
    // The requester's drive files are the ones it uploaded, referencing bt/.
    expect(await driveFiles(ctx.db, a.orgId)).toEqual([
      { name: 'E01.mkv', parent: 'Downloads/Sample Show/Season 01', object: keys[0], size: 70_000 },
      { name: 'E02.mkv', parent: 'Downloads/Sample Show/Season 01', object: keys[2], size: 33_000 },
    ])
    expect((await entries(ctx.db, torrent.infoHash)).map((entry) => [entry.kind, entry.layoutPath])).toEqual([
      ['folder', 'Sample Show'],
      ['folder', 'Sample Show/Season 01'],
      ['file', 'Sample Show/Season 01/E01.mkv'],
      ['file', 'Sample Show/Season 01/E02.mkv'],
    ])
    // The non-R2 storage verifies a sample and the torrent becomes ready.
    expect(await waitForTorrent(ctx.db, torrent.infoHash, 'ready')).toMatchObject({ verified: 'sampled' })
    const [storage] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(103_000)
  })

  it('records a scraped layout, sidecars and media, and a second workspace gets the same instantly [spec: torrents/layout-replay]', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent('Show.S01.1080p')
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)

    // The scraper's layout: show and season folders, renamed videos, and sidecars.
    const show = await createFolder(ctx.app, task, 'Downloads', 'Show (2019)')
    await createFolder(ctx.app, task, 'Downloads/Show (2019)', 'Season 01')
    const season = 'Downloads/Show (2019)/Season 01'
    const poster = await uploadFile(ctx.app, task, {
      parent: 'Downloads/Show (2019)',
      name: 'poster.jpg',
      bytes: fileBytes(500, 9),
    })
    const e01 = await uploadFile(ctx.app, task, {
      parent: season,
      name: 'Show - S01E01.mkv',
      bytes: torrent.files[0].bytes,
      torrentPath: 'Season 01/E01.mkv',
    })
    await uploadFile(ctx.app, task, {
      parent: season,
      name: 'Show - S01E02.mkv',
      bytes: torrent.files[2].bytes,
      torrentPath: 'Season 01/E02.mkv',
    })
    const thumb = await uploadFile(ctx.app, task, {
      parent: season,
      name: 'Show - S01E01-thumb.jpg',
      bytes: fileBytes(300, 8),
    })
    await putMedia(ctx.app, task, e01.id as string, {
      kind: 'episode',
      tmdb: { id: 42, type: 'tv' },
      season: 1,
      episode: 1,
      still: thumb.id,
    })
    await putMedia(ctx.app, task, show, {
      kind: 'tvshow',
      tmdb: { id: 42, type: 'tv' },
      title: 'Show',
      poster: poster.id,
    })
    // A sidecar whose upload never completes is not part of the torrent.
    const draft = await ctx.app.request('/api/objects', {
      method: 'POST',
      headers: token(task),
      body: JSON.stringify({ name: 'fanart.jpg', size: 10, parent: 'Downloads/Show (2019)', dirtype: 0 }),
    })
    expect(draft.status).toBe(201)
    expect((await completeTask(ctx.app, dl, task, show)).status.state).toBe('completed')

    const recorded = await entries(ctx.db, torrent.infoHash)
    const byLayout = Object.fromEntries(recorded.map((entry) => [entry.layoutPath, entry]))
    expect(recorded.map((entry) => [entry.kind, entry.layoutPath, entry.path])).toEqual([
      ['folder', 'Show (2019)', null],
      ['folder', 'Show (2019)/Season 01', null],
      ['sidecar', 'Show (2019)/Season 01/Show - S01E01-thumb.jpg', null],
      ['file', 'Show (2019)/Season 01/Show - S01E01.mkv', 'Season 01/E01.mkv'],
      ['file', 'Show (2019)/Season 01/Show - S01E02.mkv', 'Season 01/E02.mkv'],
      ['sidecar', 'Show (2019)/poster.jpg', null],
    ])
    for (const entry of recorded.filter((item) => item.kind !== 'folder')) {
      expect(entry.objectKey).toBe(`bt/${torrent.infoHash}/${entry.id}`)
      expect(entry.uploaded).toBe(1)
    }
    // Media names sidecars by their torrent_files ids.
    expect(JSON.parse(byLayout['Show (2019)/Season 01/Show - S01E01.mkv'].media as string)).toEqual({
      kind: 'episode',
      tmdb: { id: 42, type: 'tv' },
      season: 1,
      episode: 1,
      still: byLayout['Show (2019)/Season 01/Show - S01E01-thumb.jpg'].id,
    })
    expect(JSON.parse(byLayout['Show (2019)'].media as string)).toMatchObject({
      kind: 'tvshow',
      poster: byLayout['Show (2019)/poster.jpg'].id,
    })
    // The requester's own drive files reference the same objects.
    expect((await driveFiles(ctx.db, a.orgId)).map((file) => [`${file.parent}/${file.name}`, file.object])).toEqual(
      expect.arrayContaining([
        ['Downloads/Show (2019)/poster.jpg', byLayout['Show (2019)/poster.jpg'].objectKey],
        [`${season}/Show - S01E01.mkv`, byLayout['Show (2019)/Season 01/Show - S01E01.mkv'].objectKey],
      ]),
    )
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    // A second workspace remote-downloads the same magnet: same folders,
    // sidecars and media, at once.
    const second = await submit(ctx.app, b.headers, torrent.magnet, 'Movies')
    expect(second.status.state).toBe('completed')
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => `${file.parent}/${file.name}`)).toEqual([
      'Movies/Show (2019)/poster.jpg',
      'Movies/Show (2019)/Season 01/Show - S01E01-thumb.jpg',
      'Movies/Show (2019)/Season 01/Show - S01E01.mkv',
      'Movies/Show (2019)/Season 01/Show - S01E02.mkv',
    ])
    const episode = await matterMedia(ctx.db, b.orgId, 'Show - S01E01.mkv')
    const still = await matterMedia(ctx.db, b.orgId, 'Show - S01E01-thumb.jpg')
    expect(episode.media).toMatchObject({ kind: 'episode', still: still.id })
    const showFolder = await matterMedia(ctx.db, b.orgId, 'Show (2019)')
    const showPoster = await matterMedia(ctx.db, b.orgId, 'poster.jpg')
    expect(showFolder.media).toMatchObject({ kind: 'tvshow', poster: showPoster.id })
  })

  it('refuses metadata of a different torrent and stores nothing [spec: torrents/reject-forged-metadata]', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const wanted = sampleTorrent('Wanted')
    const forged = sampleTorrent('Forged')
    await submit(ctx.app, a.headers, wanted.magnet)
    const [assigned] = await dl.poll()

    const res = await reportInfo(ctx.app, dl, assigned, forged.infoBase64)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { details: [{ reason: 'TORRENT_INFO_MISMATCH' }] } })
    expect(await ctx.db.all(sql`SELECT id FROM torrents`)).toEqual([])
    expect([...objects.keys()].filter((key) => key.startsWith('bt/'))).toEqual([])

    // Without a reported torrent, uploads are ordinary drive files.
    const file = await uploadFile(ctx.app, assigned, {
      parent: 'Downloads',
      name: 'E01.mkv',
      bytes: forged.files[0].bytes,
      torrentPath: 'Season 01/E01.mkv',
    })
    expect(file.status).toBe(201)
    const [row] = await driveFiles(ctx.db, a.orgId)
    expect(row.object.startsWith('bt/')).toBe(false)
  })

  it('completes a submitted magnet at once from a ready torrent [spec: torrents/instant-on-submit]', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)
    const putsBefore = objects.size

    const task = await submit(ctx.app, b.headers, torrent.magnet, 'Movies')
    expect(task.status.state).toBe('completed')
    expect(task.status.assignment).toBeNull()
    expect(await dl.poll()).toEqual([])
    expect(objects.size).toBe(putsBefore)
    const keys = await fileKeys(ctx.db, torrent.infoHash)
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => [file.parent, file.name, file.object])).toEqual([
      ['Movies/Sample Show/Season 01', 'E01.mkv', keys[0]],
      ['Movies/Sample Show/Season 01', 'E02.mkv', keys[2]],
    ])
    const events = await timeline(ctx.app, b.headers, task.id)
    expect(events.find((event) => event.action === 'download_task_cache_hit')?.title).toBe(
      'Completed by instant transfer',
    )
  })

  it('joins a torrent that is still downloading and completes when it is ready [spec: torrents/join-in-progress]', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [filler] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, filler, torrent.infoBase64)).status).toBe(200)

    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    expect(joined.status.state).toBe('queued')
    expect((await timeline(ctx.app, b.headers, joined.id)).map((event) => event.title)).toContain(
      'Joined a download already in progress',
    )
    // No second download: the joined task is never assigned.
    expect((await dl.poll()).map((task) => task.id)).toEqual([filler.id])

    await fillTorrent(ctx.app, dl, filler, torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    expect((await getTask(ctx.app, b.headers, joined.id)).status.state).toBe('completed')
    const keys = await fileKeys(ctx.db, torrent.infoHash)
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => file.object)).toEqual([keys[0], keys[2]])
  })

  it('keeps downloaders that report no info dictionary uploading ordinary drive files [spec: torrents/legacy-downloader-unchanged]', async () => {
    const { ctx, a } = await setup()
    // A downloader built before Torrents uploads without reporting the info dictionary.
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    const submitted = await submit(ctx.app, a.headers, torrent.magnet)

    const [assigned] = await dl.poll()
    expect(assigned.id).toBe(submitted.id)
    expect(Object.keys(assigned.status.assignment ?? {}).sort()).toEqual([
      'assignedAt',
      'downloaderId',
      'executor',
      'uploadToken',
    ])
    const root = await createFolder(ctx.app, assigned, 'Downloads', 'Sample Show')
    const file = await uploadFile(ctx.app, assigned, {
      parent: 'Downloads/Sample Show',
      name: 'E01.mkv',
      bytes: torrent.files[0].bytes,
    })
    expect(file.status).toBe(201)
    expect((await completeTask(ctx.app, dl, assigned, root)).status.state).toBe('completed')
    const [row] = await driveFiles(ctx.db, a.orgId)
    expect(row.object.startsWith('bt/')).toBe(false)
    expect(await ctx.db.all(sql`SELECT id FROM torrents`)).toEqual([])
    // The separate cache upload API is gone.
    const legacy = await ctx.app.request(`/api/downloads/tasks/${assigned.id}/torrent`, {
      method: 'PUT',
      headers: token(assigned),
      body: JSON.stringify({ info: torrent.infoBase64 }),
    })
    expect(legacy.status).toBe(404)
  })

  it('releases joined tasks when the filling download stops, and the next download takes the torrent over', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [filler] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, filler, torrent.infoBase64)).status).toBe(200)
    // The first fill uploaded a sidecar before it stopped.
    await uploadFile(ctx.app, filler, { parent: 'Downloads', name: 'stale.nfo', bytes: fileBytes(20, 3) })
    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    expect(joined.status.state).toBe('queued')

    await ctx.deps.downloadTasks.setFields(filler.id, {
      status: 'failed',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    const [takeover] = await dl.poll()
    expect(takeover.id).toBe(joined.id)

    const completed = await fillTorrent(ctx.app, dl, takeover, torrent)
    expect(completed.status.state).toBe('completed')
    const [row] = await ctx.db.all<{ sourceTaskId: string }>(sql`
      SELECT source_task_id AS sourceTaskId FROM torrents WHERE info_hash = ${torrent.infoHash}
    `)
    expect(row.sourceTaskId).toBe(joined.id)
    expect((await entries(ctx.db, torrent.infoHash)).some((entry) => entry.layoutPath === 'stale.nfo')).toBe(false)
  })
})

describe('torrent fill edge cases', () => {
  it('verifies a sample within the completing request when no queue runs', async () => {
    const { ctx, a } = await setup({ ZPAN_ARCHIVE_JOBS_ENABLED: 'false' })
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const completed = await fillTorrent(ctx.app, dl, (await dl.poll())[0], torrent)

    expect(completed.status.state).toBe('completed')
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'ready', verified: 'sampled' })
    const [job] = await ctx.db.all<{ status: string }>(
      sql`SELECT status FROM background_jobs WHERE type = 'torrent_verify'`,
    )
    expect(job.status).toBe('completed')
  })

  it('learns a torrent_url task’s infoHash from its report, then completes, joins, or uploads into the drive', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const ready = await readyTorrent(ctx, a, dl)

    // Ready: the reporting task completes from the torrent and leaves the downloader.
    await submitTorrentUrl(ctx.app, b.headers)
    const [first] = await dl.poll()
    const hit = await reportInfo(ctx.app, dl, first, ready.infoBase64)
    expect(hit.body.status.state).toBe('completed')

    // Downloading by another task: it joins and is released from the downloader.
    const other = sampleTorrent('Other')
    await submit(ctx.app, a.headers, other.magnet)
    const [filler] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, filler, other.infoBase64)).body.status.state).toBe('assigned')
    await submitTorrentUrl(ctx.app, b.headers)
    const second = (await dl.poll()).find((task) => task.id !== filler.id) as DownloadTask
    const join = await reportInfo(ctx.app, dl, second, other.infoBase64)
    expect(join.body.status).toMatchObject({ state: 'queued', assignment: null })

    // Invalid: the task carries on uploading ordinary drive files.
    const bad = sampleTorrent('Bad')
    await submit(ctx.app, a.headers, bad.magnet)
    const [badFiller] = (await dl.poll()).filter((task) => task.id !== filler.id)
    await reportInfo(ctx.app, dl, badFiller, bad.infoBase64)
    await ctx.db.run(sql`UPDATE torrents SET status = 'invalid' WHERE info_hash = ${bad.infoHash}`)
    await submitTorrentUrl(ctx.app, b.headers)
    const third = (await dl.poll()).find((task) => ![filler.id, badFiller.id].includes(task.id)) as DownloadTask
    const drive = await reportInfo(ctx.app, dl, third, bad.infoBase64)
    expect(drive.body.status.state).toBe('assigned')
    const [row] = await ctx.db.all<{ infoHash: string; role: string | null }>(
      sql`SELECT info_hash AS infoHash, torrent_role AS role FROM download_tasks WHERE id = ${third.id}`,
    )
    expect(row).toEqual({ infoHash: bad.infoHash, role: null })
  })

  it('refuses bad reports and uploads that do not match the torrent', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submitTorrentUrl(ctx.app, a.headers)
    const [task] = await dl.poll()
    const garbage = Buffer.from('not bencode').toString('base64')
    expect((await reportInfo(ctx.app, dl, task, garbage)).status).toBe(400)
    expect((await reportInfo(ctx.app, dl, task, 'AAAA')).status).toBe(400)
    const mixed = await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ torrentInfo: torrent.infoBase64, status: 'downloading' }),
    })
    expect(mixed.status).toBe(400)
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    // Reporting again continues the same fill.
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).body.status.state).toBe('assigned')
    expect(await ctx.db.all(sql`SELECT torrent_role AS role FROM download_tasks`)).toEqual([{ role: 'fill' }])

    const unknown = await uploadFile(ctx.app, task, {
      parent: 'Downloads',
      name: 'x.mkv',
      bytes: fileBytes(10, 1),
      torrentPath: 'Season 01/E09.mkv',
    })
    expect(unknown).toMatchObject({ status: 400, body: { error: { details: [{ reason: 'TORRENT_FILE_NOT_FOUND' }] } } })
    const wrongSize = await uploadFile(ctx.app, task, {
      parent: 'Downloads',
      name: 'E01.mkv',
      bytes: fileBytes(10, 1),
      torrentPath: 'Season 01/E01.mkv',
    })
    expect(wrongSize).toMatchObject({
      status: 400,
      body: { error: { details: [{ reason: 'TORRENT_FILE_SIZE_MISMATCH' }] } },
    })
  })

  it('stores a large file of the torrent through a multipart upload', async () => {
    const { ctx, a } = await setup()
    await ctx.db.run(sql`UPDATE org_quota_entitlements SET bytes = 1000000000 WHERE org_id = ${a.orgId}`)
    await ctx.db.run(sql`UPDATE org_quotas SET quota = 1000000000 WHERE org_id = ${a.orgId}`)
    const dl = await downloader(ctx, a.userId)
    // A 100 MiB file described by its dictionary alone; the bytes are never hashed here.
    const size = 100 * 1024 * 1024
    const pieceLength = 4 * 1024 * 1024
    const info = encodeBencode({
      name: 'Big.mkv',
      'piece length': pieceLength,
      pieces: new Uint8Array((size / pieceLength) * 20),
      length: size,
    })
    await submitTorrentUrl(ctx.app, a.headers)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, Buffer.from(info).toString('base64'))).status).toBe(200)
    const uploaded = await uploadFile(ctx.app, task, {
      parent: 'Downloads',
      name: 'Big.mkv',
      bytes: new Uint8Array(size),
      torrentPath: 'Big.mkv',
    })
    expect(uploaded.status).toBe(201)
    const [entry] = await entries(ctx.db, createHash('sha1').update(info).digest('hex'))
    expect(entry).toMatchObject({ kind: 'file', layoutPath: 'Big.mkv', size, uploaded: 1 })
    expect(objects.get(entry.objectKey as string)?.length).toBe(size)
  })

  it('marks a torrent invalid when its files did not all land, and the task keeps its drive files', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    await reportInfo(ctx.app, dl, task, torrent.infoBase64)
    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    const only = await uploadFile(ctx.app, task, {
      parent: 'Downloads',
      name: 'E01.mkv',
      bytes: torrent.files[0].bytes,
      torrentPath: 'Season 01/E01.mkv',
    })
    expect((await completeTask(ctx.app, dl, task, only.id as string)).status.state).toBe('completed')
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'invalid' })
    expect((await driveFiles(ctx.db, a.orgId)).map((file) => file.name)).toEqual(['E01.mkv'])
    expect((await getTask(ctx.app, b.headers, joined.id)).status).toMatchObject({
      state: 'failed',
      error: { message: 'The torrent failed verification' },
    })
  })

  it('fails a submit that the torrent does not fit into', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)
    await ctx.db.run(sql`UPDATE org_quota_entitlements SET bytes = 1000 WHERE org_id = ${b.orgId}`)
    await ctx.db.run(sql`UPDATE org_quotas SET quota = 1000 WHERE org_id = ${b.orgId}`)

    const task = await submit(ctx.app, b.headers, torrent.magnet)
    expect(task.status.state).toBe('failed')
    expect(task.status.error?.code).toBe('QUOTA_EXCEEDED')
  })

  it('settles joined tasks on the next heartbeat when the torrent turned ready or invalid elsewhere', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const good = sampleTorrent('Good')
    const bad = sampleTorrent('Bad')
    for (const torrent of [good, bad]) await submit(ctx.app, a.headers, torrent.magnet)
    const assigned = await dl.poll()
    const fillers = [good, bad].map(
      (torrent) => assigned.find((task) => task.spec.source.uri === torrent.magnet) as DownloadTask,
    )
    for (const [index, torrent] of [good, bad].entries()) {
      expect((await reportInfo(ctx.app, dl, fillers[index], torrent.infoBase64)).status).toBe(200)
    }
    const joinedGood = await submit(ctx.app, b.headers, good.magnet)
    const joinedBad = await submit(ctx.app, b.headers, bad.magnet)
    // Verification finished without the usual hand-off (as after a crash).
    await ctx.db.run(sql`UPDATE torrents SET status = 'ready', verified = 'full' WHERE info_hash = ${good.infoHash}`)
    await ctx.db.run(sql`UPDATE torrents SET status = 'invalid' WHERE info_hash = ${bad.infoHash}`)
    await ctx.db.run(
      sql`UPDATE download_tasks SET status = 'completed' WHERE id IN (${fillers[0].id}, ${fillers[1].id})`,
    )

    await dl.poll()
    expect((await getTask(ctx.app, b.headers, joinedGood.id)).status.state).toBe('completed')
    expect((await getTask(ctx.app, b.headers, joinedBad.id)).status).toMatchObject({
      state: 'failed',
      error: { message: 'The torrent failed verification' },
    })
  })

  it('makes the first of two concurrent reports the fill and joins the other to it', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submitTorrentUrl(ctx.app, a.headers)
    await submitTorrentUrl(ctx.app, b.headers)
    const [first, second] = await dl.poll()
    expect(second).toBeDefined()

    // The first report stalls writing the info dictionary to storage.
    let release = () => {}
    const stalled = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached = () => {}
    const writing = new Promise<void>((resolve) => {
      reached = resolve
    })
    vi.spyOn(S3Service.prototype, 'putObject').mockImplementationOnce(async (_s, key, body) => {
      reached()
      await stalled
      objects.set(key, body as Uint8Array)
      return (body as Uint8Array).length
    })
    const firstReport = reportInfo(ctx.app, dl, first, torrent.infoBase64)
    await writing
    const secondReport = await reportInfo(ctx.app, dl, second, torrent.infoBase64)
    release()
    expect((await firstReport).status).toBe(200)

    expect(secondReport.status).toBe(200)
    expect(secondReport.body.status.state).toBe('queued')
    const roles = await ctx.db.all<{ id: string; role: string | null }>(
      sql`SELECT id, torrent_role AS role FROM download_tasks ORDER BY id`,
    )
    expect(Object.fromEntries(roles.map((row) => [row.id, row.role]))).toEqual({
      [first.id]: 'fill',
      [second.id]: 'join',
    })
    const [row] = await ctx.db.all<{ sourceTaskId: string }>(
      sql`SELECT source_task_id AS sourceTaskId FROM torrents WHERE info_hash = ${torrent.infoHash}`,
    )
    expect(row.sourceTaskId).toBe(first.id)
  })

  it('returns the torrent to downloading when verification cannot start, so a retried completion starts it', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    const root = await uploadTorrentTree(ctx.app, dl, task, torrent)
    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    expect(joined.status.state).toBe('queued')

    vi.spyOn(ctx.deps.backgroundJobs, 'create').mockRejectedValueOnce(new Error('queue down'))
    const failed = await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'completed', resultObjectId: root }),
    })
    expect(failed.status).toBe(500)
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'downloading' })
    expect((await getTask(ctx.app, a.headers, task.id)).status.state).not.toBe('completed')

    expect((await completeTask(ctx.app, dl, task, root)).status.state).toBe('completed')
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    await dl.poll()
    expect((await getTask(ctx.app, b.headers, joined.id)).status.state).toBe('completed')
  })

  it('gives each file of the torrent one upload: a retried create replaces its draft, and any other is refused', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    const e01 = {
      parent: 'Downloads',
      name: 'E01.mkv',
      bytes: torrent.files[0].bytes,
      torrentPath: 'Season 01/E01.mkv',
    }

    const original = await createDraft(ctx.app, task, e01)
    // The same create again, as a request retried after a lost response.
    const retried = await createDraft(ctx.app, task, e01)
    expect(retried.status).toBe(201)
    const drafts = await ctx.db.all<{ id: string; name: string }>(
      sql`SELECT id, name FROM matters WHERE org_id = ${a.orgId} AND status = 'draft' AND purged_at IS NULL`,
    )
    expect(drafts).toEqual([{ id: retried.draft?.id, name: 'E01.mkv' }])
    expect(original.draft?.id).not.toBe(retried.draft?.id)

    // The same torrent file anywhere else while its upload is open.
    const elsewhere = await createDraft(ctx.app, task, { ...e01, name: 'Copy.mkv' })
    expect(elsewhere).toMatchObject({
      status: 409,
      body: { error: { details: [{ reason: 'TORRENT_FILE_UPLOADING' }] } },
    })

    await finishDraft(ctx.app, task, retried.draft as Draft, e01.bytes)
    const again = await createDraft(ctx.app, task, e01)
    expect(again).toMatchObject({ status: 409, body: { error: { details: [{ reason: 'TORRENT_FILE_UPLOADED' }] } } })
    const file = (await entries(ctx.db, torrent.infoHash)).find((entry) => entry.path === 'Season 01/E01.mkv')
    expect(file).toMatchObject({ layoutPath: 'E01.mkv', uploaded: 1 })
    expect((await driveFiles(ctx.db, a.orgId)).filter((row) => row.object === file?.objectKey)).toHaveLength(1)
  })

  it('refuses the info dictionary once the task is uploading', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    const uploading = await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'uploading' }),
    })
    expect(uploading.status).toBe(200)

    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(409)
    expect(await ctx.db.all(sql`SELECT torrent_role AS role FROM download_tasks`)).toEqual([{ role: null }])
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toBeUndefined()
  })
})

// ─── Torrents lists (docs/design/torrents.md §3 workspace_torrents, §4, §9) ──

async function stremThruKey(ctx: TestApp, ws: { headers: Record<string, string>; orgId: string }) {
  const res = await ctx.app.request('/api/auth/api-key/create', {
    method: 'POST',
    headers: ws.headers,
    body: JSON.stringify({ configId: 'stremthru', name: 'MediaFusion', organizationId: ws.orgId }),
  })
  expect(res.status).toBe(200)
  const { key } = (await res.json()) as { key: string }
  return (path: string, init: RequestInit = {}) =>
    ctx.app.request(`/stremthru${path}`, {
      ...init,
      headers: {
        'X-StremThru-Store-Authorization': `Bearer ${key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
}

async function listEntries(db: TestApp['db'], orgId: string) {
  return db.all<{ id: string; source: string; status: string; torrentId: string | null; taskId: string | null }>(sql`
    SELECT id, source, status, torrent_id AS torrentId, task_id AS taskId FROM workspace_torrents
    WHERE org_id = ${orgId} ORDER BY created_at
  `)
}

async function findObject(app: TestApp['app'], task: DownloadTask, parent: string, name: string) {
  const res = await app.request(
    `/api/objects?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}&pageSize=1`,
    { headers: token(task) },
  )
  expect(res.status).toBe(200)
  return ((await res.json()) as { items: Array<{ id: string; name: string; dirtype: number }> }).items
}

describe('Torrents lists', () => {
  it('downloads a StremThru add for the list alone: bt/ and torrent_files, no drive rows [spec: torrents/stremthru-add-lands-in-list]', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent('Show.S01.1080p')

    const added = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    expect(added.status).toBe(201)
    const torz = ((await added.json()) as { data: { id: string; status: string } }).data
    expect(torz.status).toBe('queued')

    const [task] = await dl.poll()
    expect(task.spec.destination.folder).toBe('')
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    // The downloader's scraped plan: folders, renamed videos, a sidecar and media.
    const show = await createFolder(ctx.app, task, '', 'Show (2019)')
    expect(await createFolder(ctx.app, task, '', 'Show (2019)')).toBe(show)
    const season = await createFolder(ctx.app, task, 'Show (2019)', 'Season 01')
    const files = torrent.files.filter((file) => !file.padding)
    const e01 = await uploadFile(ctx.app, task, {
      parent: 'Show (2019)/Season 01',
      name: 'Show S01E01.mkv',
      bytes: files[0].bytes,
      torrentPath: files[0].path,
    })
    const poster = await uploadFile(ctx.app, task, {
      parent: 'Show (2019)',
      name: 'poster.jpg',
      bytes: new Uint8Array([1, 2, 3]),
    })
    // A sidecar that failed midway is cleaned up by the downloader.
    const broken = await createDraft(ctx.app, task, {
      parent: 'Show (2019)',
      name: 'fanart.jpg',
      bytes: new Uint8Array([9]),
    })
    const aborted = await ctx.app.request(
      `/api/objects/${broken.draft?.id}/uploads/${broken.draft?.upload.sessionId}`,
      { method: 'DELETE', headers: token(task) },
    )
    expect(aborted.status).toBe(204)
    await uploadFile(ctx.app, task, {
      parent: 'Show (2019)/Season 01',
      name: 'Show S01E02.mkv',
      bytes: files[1].bytes,
      torrentPath: files[1].path,
    })
    // Lookups read the torrent's own layout; a file shows only once it landed.
    expect(await findObject(ctx.app, task, 'Show (2019)', 'Season 01')).toEqual([
      expect.objectContaining({ id: season, name: 'Season 01', dirtype: 1 }),
    ])
    expect(await findObject(ctx.app, task, 'Show (2019)', 'poster.jpg')).toEqual([
      expect.objectContaining({ id: poster.id }),
    ])
    expect(await findObject(ctx.app, task, 'Show (2019)', 'fanart.jpg')).toEqual([])
    await putMedia(ctx.app, task, e01.id as string, {
      kind: 'episode',
      tmdb: { id: 1, type: 'tv' },
      season: 1,
      episode: 1,
      still: poster.id,
    })
    await putMedia(ctx.app, task, show, { kind: 'tvshow', tmdb: { id: 1, type: 'tv' }, title: 'Show', poster: 'gone' })
    const completed = await completeTask(ctx.app, dl, task, show)
    expect(completed.status.state).toBe('completed')

    // Stored once under bt/, recorded in torrent_files, and nothing in the drive.
    expect(await waitForTorrent(ctx.db, torrent.infoHash, 'ready')).toMatchObject({ verified: 'sampled' })
    expect(await driveFiles(ctx.db, a.orgId)).toEqual([])
    const [folders] = await ctx.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM matters WHERE org_id = ${a.orgId} AND purged_at IS NULL
    `)
    expect(folders.count).toBe(0)
    const rows = await entries(ctx.db, torrent.infoHash)
    expect(rows.map((row) => [row.kind, row.layoutPath])).toEqual([
      ['folder', 'Show (2019)'],
      ['folder', 'Show (2019)/Season 01'],
      ['file', 'Show (2019)/Season 01/Show S01E01.mkv'],
      ['file', 'Show (2019)/Season 01/Show S01E02.mkv'],
      ['sidecar', 'Show (2019)/poster.jpg'],
    ])
    const posterRow = rows.find((row) => row.kind === 'sidecar')
    expect(JSON.parse(rows[2].media as string)).toMatchObject({ kind: 'episode', still: posterRow?.id })
    expect(JSON.parse(rows[0].media as string)).not.toHaveProperty('poster')
    expect([...objects.keys()].filter((key) => key.startsWith('bt/')).length).toBe(4)

    // The entry follows the torrent and its files play.
    const got = await call(`/v0/store/torz/${torz.id}`)
    const item = ((await got.json()) as { data: { status: string; files: Array<{ link?: string }> } }).data
    expect(item.status).toBe('downloaded')
    expect(item.files.every((file) => typeof file.link === 'string')).toBe(true)
    expect(await listEntries(ctx.db, a.orgId)).toEqual([
      expect.objectContaining({ id: torz.id, source: 'stremthru', taskId: task.id }),
    ])
  })

  it('refuses list-only uploads before the torrent is known, and deletes a sidecar on cleanup', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent()
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const [task] = await dl.poll()

    // A downloader that never reports the dictionary has nowhere to upload.
    const early = await ctx.app.request('/api/objects', {
      method: 'POST',
      headers: token(task),
      body: JSON.stringify({ name: 'x', type: 'folder', parent: '', dirtype: 1 }),
    })
    expect(early.status).toBe(409)

    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    const nfo = await uploadFile(ctx.app, task, { parent: '', name: 'show.nfo', bytes: new Uint8Array([1]) })
    const taken = await createDraft(ctx.app, task, { parent: '', name: 'show.nfo', bytes: new Uint8Array([2]) })
    expect(taken.draft?.id).not.toBe(nfo.id)
    const removed = await ctx.app.request(`/api/objects/${nfo.id}`, { method: 'DELETE', headers: token(task) })
    expect(removed.status).toBe(204)
    expect(await findObject(ctx.app, task, '', 'show.nfo')).toEqual([])
    const presigned = await ctx.app.request(
      `/api/objects/${taken.draft?.id}/uploads/${taken.draft?.upload.sessionId}/parts`,
      { method: 'POST', headers: token(task), body: JSON.stringify({ partNumbers: [1] }) },
    )
    expect(presigned.status).toBe(200)
    expect(await driveFiles(ctx.db, a.orgId)).toEqual([])
  })

  it('lists a StremThru add of a ready torrent without a task, and one in progress waits for that download', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const ready = await readyTorrent(ctx, a, dl)
    const pending = sampleTorrent('Pending Show')
    await submit(ctx.app, a.headers, pending.magnet)
    const [filling] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, filling, pending.infoBase64)).status).toBe(200)
    const call = await stremThruKey(ctx, b)

    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: ready.magnet }) })
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: pending.magnet }) })

    expect((await listEntries(ctx.db, b.orgId)).map((entry) => [entry.source, entry.status, entry.taskId])).toEqual([
      ['stremthru', 'active', null],
      ['stremthru', 'active', null],
    ])
    const [tasks] = await ctx.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM download_tasks WHERE org_id = ${b.orgId}
    `)
    expect(tasks.count).toBe(0)

    // The download fails: the entry waiting on it fails too.
    const failed = await ctx.app.request(`/api/downloads/tasks/${filling.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'failed', errorMessage: 'tracker down' }),
    })
    expect(failed.status).toBe(200)
    expect((await listEntries(ctx.db, b.orgId))[1]).toMatchObject({ status: 'failed' })
    const listed = await call('/v0/store/torz')
    const items = ((await listed.json()) as { data: { items: Array<{ status: string }> } }).data.items
    expect(items.map((item) => item.status).sort()).toEqual(['downloaded', 'failed'])
  })

  it('lands a remote download in the drive and in the Torrents list [spec: torrents/remote-download-in-list]', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)

    const submitted = await submit(ctx.app, b.headers, torrent.magnet)

    expect((await getTask(ctx.app, b.headers, submitted.id)).status.state).toBe('completed')
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => `${file.parent}/${file.name}`)).toEqual([
      'Downloads/Sample Show/Season 01/E01.mkv',
      'Downloads/Sample Show/Season 01/E02.mkv',
    ])
    const [entry] = await listEntries(ctx.db, b.orgId)
    expect(entry).toMatchObject({ source: 'download', taskId: submitted.id })
    const res = await ctx.app.request('/api/torrents', { headers: b.headers })
    expect(res.status).toBe(200)
    const page = (await res.json()) as { items: Array<{ id: string; status: string; source: string; name: string }> }
    expect(page.items).toEqual([
      expect.objectContaining({ id: entry.id, status: 'ready', source: 'download', name: 'Sample Show' }),
    ])
    // The filling workspace's own entry is a download entry too.
    expect(await listEntries(ctx.db, a.orgId)).toEqual([expect.objectContaining({ source: 'download' })])
    // Submitting again reuses the entry.
    await submit(ctx.app, b.headers, torrent.magnet, 'Again')
    expect(await listEntries(ctx.db, b.orgId)).toHaveLength(1)
  })

  it('serves the Torrents page: tree, play link, Save to drive, Remove [spec: torrents/save-to-drive]', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)
    const call = await stremThruKey(ctx, b)
    const added = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const { id } = ((await added.json()) as { data: { id: string } }).data
    vi.spyOn(S3Service.prototype, 'presignDownload').mockImplementation(async (_s, key) => `mem://get/${key}`)

    const detail = await ctx.app.request(`/api/torrents/${id}`, { headers: b.headers })
    expect(detail.status).toBe(200)
    const body = (await detail.json()) as {
      status: string
      playable: boolean
      size: number
      files: Array<{ id: string; index: number; path: string; size: number }>
    }
    expect(body).toMatchObject({ status: 'ready', playable: true, size: 103_000 })
    expect(body.files.map((file) => [file.index, file.path])).toEqual([
      [0, 'Season 01/E01.mkv'],
      [2, 'Season 01/E02.mkv'],
    ])

    const link = await ctx.app.request(`/api/torrents/${id}/files/${body.files[0].id}/links`, {
      method: 'POST',
      headers: b.headers,
    })
    expect(link.status).toBe(201)
    const keys = await fileKeys(ctx.db, torrent.infoHash)
    expect(((await link.json()) as { url: string }).url).toBe(`mem://get/${keys[0]}`)
    const [played] = await ctx.db.all<{ lastPlayedAt: number | null }>(sql`
      SELECT last_played_at AS lastPlayedAt FROM workspace_torrents WHERE id = ${id}
    `)
    expect(played.lastPlayedAt).not.toBeNull()

    const saved = await ctx.app.request(`/api/torrents/${id}/transfers`, {
      method: 'POST',
      headers: b.headers,
      body: JSON.stringify({ folder: 'Library/TV' }),
    })
    expect(saved.status).toBe(201)
    expect(((await saved.json()) as { files: unknown[] }).files).toHaveLength(2)
    expect(await driveFiles(ctx.db, b.orgId)).toEqual([
      { name: 'E01.mkv', parent: 'Library/TV/Sample Show/Season 01', object: keys[0], size: 70_000 },
      { name: 'E02.mkv', parent: 'Library/TV/Sample Show/Season 01', object: keys[2], size: 33_000 },
    ])
    const [quota] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${b.orgId}`)
    expect(quota.used).toBe(103_000)

    const removed = await ctx.app.request(`/api/torrents/${id}`, { method: 'DELETE', headers: b.headers })
    expect(removed.status).toBe(204)
    expect(await listEntries(ctx.db, b.orgId)).toEqual([])
    expect(await driveFiles(ctx.db, b.orgId)).toHaveLength(2)
    expect((await ctx.app.request(`/api/torrents/${id}`, { headers: b.headers })).status).toBe(404)
  })

  it('resolves torrent URL entries and merges them into the entry the workspace already holds', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)
    const call = await stremThruKey(ctx, b)
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const url = 'https://example.com/show.torrent'

    // A StremThru add of a torrent URL runs a list-only task until its infoHash is known.
    const first = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: url }) })
    const again = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: url }) })
    const pending = ((await first.json()) as { data: { id: string; status: string } }).data
    expect(pending.status).toBe('queued')
    expect(((await again.json()) as { data: { id: string } }).data.id).toBe(pending.id)
    const [listTask] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, listTask, torrent.infoBase64)).status).toBe(200)

    // It resolved to the torrent the workspace holds: one entry, and the task is done without drive files.
    expect((await getTask(ctx.app, b.headers, listTask.id)).status.state).toBe('completed')
    expect(await listEntries(ctx.db, b.orgId)).toEqual([
      expect.objectContaining({ source: 'stremthru', status: 'active', taskId: listTask.id }),
    ])
    expect(await driveFiles(ctx.db, b.orgId)).toEqual([])
    // Adding the link again finds the entry it merged into, by the infoHash its task learned.
    const readded = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: url }) })
    expect(((await readded.json()) as { data: { id: string; status: string } }).data).toMatchObject({
      status: 'downloaded',
    })
    expect(await dl.poll()).toEqual([])
    expect(await listEntries(ctx.db, b.orgId)).toHaveLength(1)

    // A remote download of a torrent URL merges the same way, and the entry becomes a download one.
    const remote = await submitTorrentUrl(ctx.app, b.headers)
    const [remoteTask] = await dl.poll()
    expect(remoteTask.id).toBe(remote.id)
    expect((await reportInfo(ctx.app, dl, remoteTask, torrent.infoBase64)).status).toBe(200)
    expect(await listEntries(ctx.db, b.orgId)).toEqual([
      expect.objectContaining({ source: 'download', status: 'active', taskId: remote.id }),
    ])
    expect(await driveFiles(ctx.db, b.orgId)).toHaveLength(2)

    // The list is searchable by name and infoHash.
    const byName = await ctx.app.request('/api/torrents?search=sample', { headers: b.headers })
    const byHash = await ctx.app.request(`/api/torrents?search=${torrent.infoHash.slice(0, 8)}`, { headers: b.headers })
    const none = await ctx.app.request('/api/torrents?search=nothing', { headers: b.headers })
    expect(((await byName.json()) as { items: unknown[] }).items).toHaveLength(1)
    expect(((await byHash.json()) as { items: unknown[] }).items).toHaveLength(1)
    expect(((await none.json()) as { items: unknown[] }).items).toHaveLength(0)
  })

  it('reopens a failed remote download’s entry when the task is retried', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    const task = await submit(ctx.app, a.headers, torrent.magnet)
    await dl.poll()
    const failed = await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'failed', errorMessage: 'no peers' }),
    })
    expect(failed.status).toBe(200)
    expect((await listEntries(ctx.db, a.orgId))[0]).toMatchObject({ status: 'failed' })
    const page = (await (await ctx.app.request('/api/torrents', { headers: a.headers })).json()) as {
      items: Array<{ status: string; error: string | null }>
    }
    expect(page.items[0]).toMatchObject({ status: 'failed', error: 'no peers' })

    const retried = await ctx.app.request(`/api/downloads/tasks/${task.id}/attempts`, {
      method: 'POST',
      headers: a.headers,
      body: JSON.stringify({}),
    })
    expect(retried.status).toBeLessThan(300)
    expect((await listEntries(ctx.db, a.orgId))[0]).toMatchObject({ status: 'active' })
  })

  it('settles list-only tasks without a download when the torrent turns up elsewhere, and fails them on an invalid one', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, b)
    const torrent = sampleTorrent()
    // A fills the torrent; B's StremThru add of its torrent URL learns it is in progress.
    await submit(ctx.app, a.headers, torrent.magnet)
    const [filling] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, filling, torrent.infoBase64)).status).toBe(200)
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: 'https://example.com/a.torrent' }) })
    const [listTask] = (await dl.poll()).filter((task) => task.id !== filling.id)
    expect((await reportInfo(ctx.app, dl, listTask, torrent.infoBase64)).status).toBe(200)
    expect((await getTask(ctx.app, b.headers, listTask.id)).status.state).toBe('completed')
    expect(await listEntries(ctx.db, b.orgId)).toEqual([expect.objectContaining({ status: 'active' })])

    // An invalid torrent fails a list-only task, whether met at assignment or on its report.
    const bad = sampleTorrent('Bad Show')
    await ctx.deps.torrents.create({
      infoHash: bad.infoHash,
      storageId: STORAGE_ID,
      name: 'Bad Show',
      private: false,
      status: 'downloading',
      files: [{ fileIdx: 0, path: 'x.mkv', size: 1, mime: 'video/x-matroska' }],
    })
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: bad.magnet }) })
    const [badEntry] = await ctx.db.all<{ taskId: string }>(sql`
      SELECT task_id AS taskId FROM workspace_torrents WHERE info_hash = ${bad.infoHash}
    `)
    await ctx.db.run(sql`UPDATE torrents SET status = 'invalid' WHERE info_hash = ${bad.infoHash}`)
    await dl.poll()
    expect((await getTask(ctx.app, b.headers, badEntry.taskId)).status.state).toBe('failed')
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: 'https://example.com/bad.torrent' }) })
    const [urlTask] = (await dl.poll()).filter((task) => task.spec.source.uri === 'https://example.com/bad.torrent')
    expect((await reportInfo(ctx.app, dl, urlTask, bad.infoBase64)).status).toBe(200)
    expect((await getTask(ctx.app, b.headers, urlTask.id)).status.state).toBe('failed')
    // A StremThru add of the invalid torrent fails at once.
    const direct = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: bad.magnet }) })
    expect(((await direct.json()) as { data: { status: string } }).data.status).toBe('failed')

    // A torrent being evicted when the report arrives fails the task as such, not as an invalid torrent.
    const gone = sampleTorrent('Gone Show')
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: 'https://example.com/gone.torrent' }) })
    const [goneTask] = (await dl.poll()).filter((task) => task.spec.source.uri === 'https://example.com/gone.torrent')
    await ctx.deps.torrents.create({
      infoHash: gone.infoHash,
      storageId: STORAGE_ID,
      name: 'Gone Show',
      private: false,
      status: 'evicting',
      files: [{ fileIdx: 0, path: 'x.mkv', size: 1, mime: 'video/x-matroska' }],
    })
    expect((await reportInfo(ctx.app, dl, goneTask, gone.infoBase64)).status).toBe(200)
    const goneState = await getTask(ctx.app, b.headers, goneTask.id)
    expect(goneState.status).toMatchObject({ state: 'failed', error: { message: TORRENT_EVICTING_MESSAGE } })
  })

  it('keeps the entry of the task that fills the torrent when two entries of a workspace meet it', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent()
    // A StremThru add of the magnet and a remote download of a torrent URL for the same torrent.
    await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const remote = await submitTorrentUrl(ctx.app, a.headers)
    // The remote download makes the StremThru entry a download one, which keeps
    // its list-only task while that task runs.
    await submit(ctx.app, a.headers, torrent.magnet, 'Other')
    const entriesBefore = await listEntries(ctx.db, a.orgId)
    expect(entriesBefore.map((entry) => entry.source).sort()).toEqual(['download', 'download'])
    expect(entriesBefore.every((entry) => entry.taskId)).toBe(true)
    const tasks = await dl.poll()
    const urlTask = tasks.find((task) => task.id === remote.id) as DownloadTask
    // The torrent URL reports first and becomes the fill: the magnet's entry merges into its entry.
    expect((await reportInfo(ctx.app, dl, urlTask, torrent.infoBase64)).status).toBe(200)
    expect(await listEntries(ctx.db, a.orgId)).toEqual([
      expect.objectContaining({ source: 'download', taskId: remote.id, status: 'active' }),
    ])
  })

  it('leaves waiting downloads alone when a fill fails, and keeps a fill that others still hold', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    const callA = await stremThruKey(ctx, a)
    const callB = await stremThruKey(ctx, b)
    const added = await callA('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const { id } = ((await added.json()) as { data: { id: string } }).data
    const [fill] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, fill, torrent.infoBase64)).status).toBe(200)
    // B waits on the same download, without a task of its own.
    await callB('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    // Removing A's entry keeps the fill: B still holds the torrent.
    await ctx.app.request(`/api/torrents/${id}`, { method: 'DELETE', headers: a.headers })
    expect((await getTask(ctx.app, a.headers, fill.id)).status.state).not.toBe('canceling')
    // A remote download in B joins the download and keeps its own task.
    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    const failed = await ctx.app.request(`/api/downloads/tasks/${fill.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'failed', errorMessage: 'disk full' }),
    })
    expect(failed.status).toBe(200)
    expect(await listEntries(ctx.db, b.orgId)).toEqual([
      expect.objectContaining({ source: 'download', taskId: joined.id, status: 'active' }),
    ])
  })

  it('refuses to play or save a torrent that is not ready, and cancels its list-only fill once nobody holds it', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent()
    const added = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const { id } = ((await added.json()) as { data: { id: string } }).data
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)

    const detail = (await (await ctx.app.request(`/api/torrents/${id}`, { headers: a.headers })).json()) as {
      status: string
      playable: boolean
      files: Array<{ id: string }>
    }
    expect(detail).toMatchObject({ status: 'downloading', playable: false })
    const link = await ctx.app.request(`/api/torrents/${id}/files/${detail.files[0].id}/links`, {
      method: 'POST',
      headers: a.headers,
    })
    expect(link.status).toBe(409)
    const saved = await ctx.app.request(`/api/torrents/${id}/transfers`, {
      method: 'POST',
      headers: a.headers,
      body: JSON.stringify({ folder: '' }),
    })
    expect(saved.status).toBe(409)

    await ctx.app.request(`/api/torrents/${id}`, { method: 'DELETE', headers: a.headers })

    expect((await getTask(ctx.app, a.headers, task.id)).status.state).toBe('canceling')
  })

  it('adds one entry and one task for concurrent StremThru adds of the same magnet', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent()
    const add = () => call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })

    const [first, second] = await Promise.all([add(), add()])

    const ids = await Promise.all(
      [first, second].map(async (res) => ((await res.json()) as { data: { id: string } }).data.id),
    )
    expect(ids[0]).toBe(ids[1])
    expect(await listEntries(ctx.db, a.orgId)).toHaveLength(1)
    const tasks = await dl.poll()
    expect(tasks).toHaveLength(1)
    // Its info dictionary attaches the one entry, and a retried report is answered the same way.
    expect((await reportInfo(ctx.app, dl, tasks[0], torrent.infoBase64)).status).toBe(200)
    expect((await reportInfo(ctx.app, dl, tasks[0], torrent.infoBase64)).status).toBe(200)
    expect(await listEntries(ctx.db, a.orgId)).toEqual([
      expect.objectContaining({ id: ids[0], status: 'active', taskId: tasks[0].id }),
    ])
  })

  it('reuses a resolved torrent URL entry when an addon adds the link again', async () => {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = await readyTorrent(ctx, a, dl)
    const call = await stremThruKey(ctx, b)
    const url = 'https://example.com/show.torrent'
    const first = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: url }) })
    const { id } = ((await first.json()) as { data: { id: string } }).data
    const [listTask] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, listTask, torrent.infoBase64)).status).toBe(200)
    expect(await listEntries(ctx.db, b.orgId)).toEqual([expect.objectContaining({ id })])
    const resolved = await call(`/v0/store/torz/${id}`)
    expect(((await resolved.json()) as { data: { status: string } }).data.status).toBe('downloaded')

    const again = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: url }) })

    expect(((await again.json()) as { data: { id: string; status: string } }).data).toEqual(
      expect.objectContaining({ id, status: 'downloaded' }),
    )
    expect(await dl.poll()).toEqual([])
    expect(await listEntries(ctx.db, b.orgId)).toHaveLength(1)
  })

  it('sweeps the partial objects of a list-only fill canceled once nobody held it', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent()
    const added = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: torrent.magnet }) })
    const { id } = ((await added.json()) as { data: { id: string } }).data
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    const files = torrent.files.filter((file) => !file.padding)
    await uploadFile(ctx.app, task, { parent: '', name: 'E01.mkv', bytes: files[0].bytes, torrentPath: files[0].path })
    expect([...objects.keys()].filter((key) => key.startsWith('bt/')).length).toBeGreaterThan(0)

    await ctx.app.request(`/api/torrents/${id}`, { method: 'DELETE', headers: a.headers })
    const canceled = await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceled.status).toBe(200)

    // Its last uploads may still land for a while, so it stays until the grace period passed.
    expect(await evictTorrents(ctx.deps, new Date())).toBe(0)
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'downloading' })
    const later = new Date(Date.now() + ABANDONED_FILL_GRACE_MS + 60_000)
    expect(await evictTorrents(ctx.deps, later)).toBe(1)
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toBeUndefined()
    expect([...objects.keys()].filter((key) => key.startsWith('bt/'))).toEqual([])
  })

  it('keeps a downloading torrent that something still holds or downloads', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    const later = new Date(Date.now() + ABANDONED_FILL_GRACE_MS + 60_000)

    // Active, and held by the remote download's entry.
    expect(await evictTorrents(ctx.deps, later)).toBe(0)
    await ctx.app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: dl.headers,
      body: JSON.stringify({ status: 'failed', errorMessage: 'tracker down' }),
    })
    // Stopped, but its failed entry still holds it until the user removes it.
    expect(await evictTorrents(ctx.deps, later)).toBe(0)
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'downloading' })
  })
})

describe('streaming a torrent while it downloads', () => {
  const STREAM_CAPABILITIES = ['magnet', 'torrent', 'torrent_stream']

  // The torrent's concatenated bytes, padding as zeros.
  function torrentBytes(torrent: TorrentFixture): Uint8Array {
    return Buffer.concat(torrent.files.map((file) => file.bytes))
  }

  function pieces(torrent: TorrentFixture, from: number, to: number): Uint8Array {
    return torrentBytes(torrent).slice(from * torrent.pieceLength, to * torrent.pieceLength)
  }

  async function streamState(app: TestApp['app'], dl: Downloader, task: DownloadTask) {
    const res = await app.request(`/api/downloads/tasks/${task.id}/torrent-stream`, { headers: dl.headers })
    return {
      status: res.status,
      body: (await res.json()) as { wants: number[]; chunks: unknown[]; pieceLength: number },
    }
  }

  async function putChunk(app: TestApp['app'], dl: Downloader, task: DownloadTask, first: number, bytes: Uint8Array) {
    const res = await app.request(`/api/downloads/tasks/${task.id}/torrent-stream/chunks/${first}`, {
      method: 'PUT',
      headers: { ...dl.headers, 'Content-Type': 'application/octet-stream' },
      // A copy: a Buffer view's .buffer is its whole pool.
      body: Uint8Array.from(bytes).buffer,
    })
    return { status: res.status, body: (await res.json()) as { pieceCount?: number; error?: { message: string } } }
  }

  type Item = { id: string; status: string; files: Array<{ index: number; link?: string }> }

  // Adds the magnet through StremThru and returns the entry once its torrent is known.
  async function addAndGet(call: Awaited<ReturnType<typeof stremThruKey>>, magnet: string, id?: string) {
    if (!id) {
      const added = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: magnet }) })
      expect(added.status).toBe(201)
      id = ((await added.json()) as { data: Item }).data.id
    }
    const got = await call(`/v0/store/torz/${id}`)
    return ((await got.json()) as { data: Item }).data
  }

  async function generate(call: Awaited<ReturnType<typeof stremThruKey>>, link: string) {
    const res = await call('/v0/store/torz/link/generate', { method: 'POST', body: JSON.stringify({ link }) })
    return { status: res.status, body: (await res.json()) as { data?: { link: string } } }
  }

  async function streamWhileDownloading() {
    const { ctx, a, b } = await setup()
    const dl = await downloader(ctx, a.userId, STREAM_CAPABILITIES)
    const callA = await stremThruKey(ctx, a)
    const torrent = sampleTorrent('Streamed.Show.S01')
    const added = await addAndGet(callA, torrent.magnet)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    return { ctx, a, b, dl, callA, torrent, task, entryId: added.id }
  }

  it('plays a torrent as its pieces arrive, before it is ready [spec: torrents/stream-while-downloading]', async () => {
    const { ctx, dl, callA, torrent, task, entryId } = await streamWhileDownloading()

    // Addons see it downloaded, with links, while check still calls it uncached.
    const item = await addAndGet(callA, torrent.magnet, entryId)
    expect(item.status).toBe('downloaded')
    expect(item.files.map((file) => file.index)).toEqual([0, 2])
    const check = await callA(`/v0/store/torz/check?hash=${torrent.infoHash}`)
    expect(((await check.json()) as { data: { items: Array<{ status: string }> } }).data.items[0].status).toBe(
      'unknown',
    )
    const generated = await generate(callA, item.files[0].link as string)
    expect(generated.status).toBe(200)
    const link = generated.body.data?.link as string
    expect(link).toContain('/stremthru/stream/')

    const head = await ctx.app.request(link, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Length')).toBe('70000')
    expect(head.headers.get('Accept-Ranges')).toBe('bytes')

    // The add asks for the head and tail of its largest file before any player does.
    expect((await streamState(ctx.app, dl, task)).body.wants).toEqual([0, 4])

    // The player asks before the piece arrives: the answer waits for it.
    const playing = await ctx.app.request(link, { headers: { Range: 'bytes=100-199' } })
    expect(playing.status).toBe(206)
    expect(playing.headers.get('Content-Range')).toBe('bytes 100-199/70000')
    const body = playing.arrayBuffer()
    const state = await streamState(ctx.app, dl, task)
    expect(state.status).toBe(200)
    expect(state.body.wants).toContain(0)
    expect(state.body.pieceLength).toBe(torrent.pieceLength)

    // A chunk whose bytes are not the torrent's is refused.
    const forged = await putChunk(ctx.app, dl, task, 0, new Uint8Array(torrent.pieceLength))
    expect(forged.status).toBe(400)
    // Pieces that are not whole are refused.
    expect((await putChunk(ctx.app, dl, task, 0, pieces(torrent, 0, 1).slice(0, 100))).status).toBe(400)

    const stored = await putChunk(ctx.app, dl, task, 0, pieces(torrent, 0, 2))
    expect(stored).toEqual({ status: 201, body: { firstPiece: 0, pieceCount: 2 } })
    expect(new Uint8Array(await body)).toEqual(torrent.files[0].bytes.slice(100, 200))

    // A range across the end of the chunk reads the next one once it arrives.
    const across = await ctx.app.request(link, { headers: { Range: 'bytes=32700-32799' } })
    const acrossBody = across.arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await putChunk(ctx.app, dl, task, 2, pieces(torrent, 2, 3))).status).toBe(201)
    expect(new Uint8Array(await acrossBody)).toEqual(torrent.files[0].bytes.slice(32700, 32800))
    expect((await streamState(ctx.app, dl, task)).body.chunks).toEqual([
      { firstPiece: 0, pieceCount: 2 },
      { firstPiece: 2, pieceCount: 1 },
    ])
  }, 20_000)

  it('serves the verified pieces to another workspace that holds the torrent [spec: torrents/stream-shared-across-workspaces]', async () => {
    const { ctx, b, dl, torrent, task } = await streamWhileDownloading()
    expect((await putChunk(ctx.app, dl, task, 0, pieces(torrent, 0, 2))).status).toBe(201)

    // A second workspace adds the same torrent while it downloads, and plays it at once.
    const callB = await stremThruKey(ctx, b)
    const item = await addAndGet(callB, torrent.magnet)
    expect(item.status).toBe('downloaded')
    const link = (await generate(callB, item.files[0].link as string)).body.data?.link as string
    const res = await ctx.app.request(link, { headers: { Range: 'bytes=0-9' } })
    expect(res.status).toBe(206)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(torrent.files[0].bytes.slice(0, 10))
  }, 20_000)

  it('reads the ready file through the same link once the torrent is ready, and drops its chunks [spec: torrents/stream-after-ready]', async () => {
    const { ctx, dl, callA, torrent, task, entryId } = await streamWhileDownloading()
    const item = await addAndGet(callA, torrent.magnet, entryId)
    const link = (await generate(callA, item.files[0].link as string)).body.data?.link as string
    expect((await putChunk(ctx.app, dl, task, 0, pieces(torrent, 0, 2))).status).toBe(201)
    expect([...objects.keys()].some((key) => key.includes('/stream/'))).toBe(true)

    // The downloader finishes: the files land and the torrent verifies.
    await fillTorrent(ctx.app, dl, task, torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    expect([...objects.keys()].some((key) => key.includes('/stream/'))).toBe(false)
    const [chunks] = await ctx.db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM torrent_stream_chunks`)
    expect(chunks.count).toBe(0)
    // The link stays on ZPan's origin: a player's media element refuses ranges
    // of one file that come from two origins.
    const res = await ctx.app.request(link, { headers: { Range: 'bytes=70000-' } })
    expect(res.status).toBe(416)
    const tail = await ctx.app.request(link, { headers: { Range: 'bytes=69990-' } })
    expect(tail.status).toBe(206)
    expect(tail.headers.get('Content-Range')).toBe('bytes 69990-69999/70000')
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(torrent.files[0].bytes.slice(69990))
    // Generating the link again now hands out the file's presigned URL, uncharged.
    const again = (await generate(callA, item.files[0].link as string)).body.data?.link as string
    expect(again).not.toContain('/stremthru/stream/')
    expect(again).toContain((await fileKeys(ctx.db, torrent.infoHash))[0])
    const [charges] = await ctx.db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM audit_events WHERE action = 'object_download' AND target_id = (
        SELECT id FROM torrent_files WHERE object_key = ${(await fileKeys(ctx.db, torrent.infoHash))[0]})
    `)
    expect(charges.count).toBe(1)
    // The downloader is told the torrent no longer streams from its task.
    expect((await streamState(ctx.app, dl, task)).status).toBe(409)
  }, 20_000)

  it('shows the filling workspace its torrent downloaded while it verifies, so addons play it', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent('Verifying.Show')
    const added = await addAndGet(call, torrent.magnet)
    const [task] = await dl.poll()
    // Verification that cannot finish keeps the torrent verifying.
    vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(() => new Promise(() => {}))
    const filling = fillTorrent(ctx.app, dl, task, torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'verifying')
    const item = await addAndGet(call, torrent.magnet, added.id)
    expect(item.status).toBe('downloaded')
    expect(item.files.every((file) => typeof file.link === 'string')).toBe(true)
    void filling
  })

  it('keeps a torrent waiting when its downloader does not stream [spec: torrents/stream-needs-capable-downloader]', async () => {
    const { ctx, a } = await setup()
    const dl = await downloader(ctx, a.userId)
    const call = await stremThruKey(ctx, a)
    const torrent = sampleTorrent('Not.Streamed')
    const added = await addAndGet(call, torrent.magnet)
    const [task] = await dl.poll()
    expect((await reportInfo(ctx.app, dl, task, torrent.infoBase64)).status).toBe(200)
    const item = await addAndGet(call, torrent.magnet, added.id)
    expect(item.status).toBe('downloading')
    expect(item.files).toEqual([])
  })

  it('refuses stream calls from a downloader the task is not assigned to, and forged stream links', async () => {
    const { ctx, a, task } = await streamWhileDownloading()
    const other = await downloader(ctx, a.userId, ['http', 'torrent_stream'])
    expect((await streamState(ctx.app, other, task)).status).toBe(404)
    const forged = await ctx.app.request('/stremthru/stream/bm90LWEtdG9rZW4.c2ln')
    expect(forged.status).toBe(404)
  })
})
