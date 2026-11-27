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
  hostname: 'cache-downloader',
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

// Uploads one file through the object API under the task's upload token.
async function uploadFile(
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
  const draft = (await res.json()) as {
    id: string
    upload: { sessionId: string; parts: Array<{ partNumber: number; url: string; offset: number; length: number }> }
  }
  for (const part of draft.upload.parts) upload(part.url, file.bytes.subarray(part.offset, part.offset + part.length))
  const done = await app.request(`/api/objects/${draft.id}/uploads/${draft.upload.sessionId}/completions`, {
    method: 'POST',
    headers: token(task),
    body: JSON.stringify({ parts: draft.upload.parts.map((part) => ({ partNumber: part.partNumber, etag: 'etag' })) }),
  })
  expect(done.status).toBe(200)
  return { status: 201, id: draft.id }
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
  return completeTask(app, dl, task, root)
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
    // A downloader built before Torrents still reports the old capability.
    const dl = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
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
})
