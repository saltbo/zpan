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

const STORAGE_ID = 'torrent-cache-storage'

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
  vi.spyOn(S3Service.prototype, 'listTorrentCacheKeys').mockImplementation(async (_s, prefix) =>
    [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(),
  )
  vi.spyOn(S3Service.prototype, 'evictTorrentCacheObjects').mockImplementation(async (_s, keys) => {
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

async function downloader(ctx: TestApp, ownerId: string, capabilities: string[]) {
  const created = await createDownloader(
    ctx.deps,
    ctx.platform,
    { name: `dl-${capabilities.join('-')}`, heartbeat: { ...heartbeat, capabilities } },
    ownerId,
  )
  return async () => {
    const res = await ctx.app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...heartbeat, capabilities }),
    })
    expect(res.status).toBe(200)
    return ((await res.json()) as { assignments: DownloadTask[] }).assignments
  }
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

// Acts as a capable downloader: registers the info dictionary, uploads every
// file through the presigned uploads, and completes the torrent.
async function fillCache(app: TestApp['app'], task: DownloadTask, torrent: TorrentFixture) {
  const token = task.status.assignment?.uploadToken as string
  const register = await app.request(`/api/downloads/tasks/${task.id}/torrent`, {
    method: 'PUT',
    headers: bearer(token),
    body: JSON.stringify({ info: torrent.infoBase64 }),
  })
  expect(register.status).toBe(200)
  const registration = (await register.json()) as { outcome: string; files: Array<{ fileIdx: number }> }
  expect(registration.outcome).toBe('fill')
  for (const file of torrent.files.filter((item) => !item.padding)) {
    const start = await app.request(`/api/downloads/tasks/${task.id}/torrent/files/${file.fileIdx}/uploads`, {
      method: 'POST',
      headers: bearer(token),
    })
    expect(start.status).toBe(201)
    const plan = (await start.json()) as {
      uploadId: string | null
      parts: Array<{ partNumber: number; url: string; offset: number; length: number }>
    }
    for (const part of plan.parts) upload(part.url, file.bytes.subarray(part.offset, part.offset + part.length))
    const done = await app.request(`/api/downloads/tasks/${task.id}/torrent/files/${file.fileIdx}/completions`, {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({
        uploadId: plan.uploadId,
        parts: plan.parts.map((part) => ({ partNumber: part.partNumber, etag: `etag-${part.partNumber}` })),
      }),
    })
    expect(done.status).toBe(200)
  }
  const complete = await app.request(`/api/downloads/tasks/${task.id}/torrent/completions`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({
      files: torrent.files
        .filter((item) => !item.padding)
        .map((file) => ({ path: file.path, size: file.bytes.length })),
    }),
  })
  expect(complete.status).toBe(200)
  return (await complete.json()) as DownloadTask
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
  const a = await workspace(ctx.app, ctx.db, 'cache-a@example.com')
  const b = await workspace(ctx.app, ctx.db, 'cache-b@example.com')
  return { ctx, a, b }
}

describe('torrent cache fill', () => {
  it('fills the cache from a capable downloader and gives the requester the files [spec: torrent-cache/fill-from-download]', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    const submitted = await submit(ctx.app, a.headers, torrent.magnet)

    const [assigned] = await poll()
    expect(assigned.id).toBe(submitted.id)
    expect(assigned.status.assignment?.torrentCache).toBe(true)

    const completed = await fillCache(ctx.app, assigned, torrent)
    expect(completed.status.state).toBe('completed')

    // Cached under bt/<infoHash>/: the info dictionary and every non-padding file.
    expect(objects.get(`bt/${torrent.infoHash}/info`)).toEqual(torrent.info)
    expect([...objects.keys()].filter((key) => key.startsWith('bt/')).sort()).toEqual([
      `bt/${torrent.infoHash}/0`,
      `bt/${torrent.infoHash}/2`,
      `bt/${torrent.infoHash}/info`,
    ])
    expect(await driveFiles(ctx.db, a.orgId)).toEqual([
      {
        name: 'E01.mkv',
        parent: 'Downloads/Sample Show/Season 01',
        object: `bt/${torrent.infoHash}/0`,
        size: 70_000,
      },
      {
        name: 'E02.mkv',
        parent: 'Downloads/Sample Show/Season 01',
        object: `bt/${torrent.infoHash}/2`,
        size: 33_000,
      },
    ])
    // The non-R2 storage verifies a sample and the torrent becomes ready.
    expect(await waitForTorrent(ctx.db, torrent.infoHash, 'ready')).toMatchObject({ verified: 'sampled' })
    const [storage] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(103_000)
  })

  it('refuses metadata of a different torrent and caches nothing [spec: torrent-cache/reject-forged-metadata]', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const wanted = sampleTorrent('Wanted')
    const forged = sampleTorrent('Forged')
    await submit(ctx.app, a.headers, wanted.magnet)
    const [assigned] = await poll()

    const res = await ctx.app.request(`/api/downloads/tasks/${assigned.id}/torrent`, {
      method: 'PUT',
      headers: bearer(assigned.status.assignment?.uploadToken as string),
      body: JSON.stringify({ info: forged.infoBase64 }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { details: [{ reason: 'TORRENT_INFO_MISMATCH' }] } })
    expect(await ctx.db.all(sql`SELECT id FROM torrents`)).toEqual([])
    expect([...objects.keys()].filter((key) => key.startsWith('bt/'))).toEqual([])

    // Files cannot be uploaded into the cache without a registered torrent.
    const start = await ctx.app.request(`/api/downloads/tasks/${assigned.id}/torrent/files/0/uploads`, {
      method: 'POST',
      headers: bearer(assigned.status.assignment?.uploadToken as string),
    })
    expect(start.status).toBe(409)
  })

  it('completes a submitted magnet at once from a ready torrent [spec: torrent-cache/instant-on-submit]', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    await fillCache(ctx.app, (await poll())[0], torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    const putsBefore = objects.size

    const task = await submit(ctx.app, b.headers, torrent.magnet, 'Movies')
    expect(task.status.state).toBe('completed')
    expect(task.status.assignment).toBeNull()
    expect(await poll()).toEqual([])
    expect(objects.size).toBe(putsBefore)
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => [file.parent, file.name, file.object])).toEqual([
      ['Movies/Sample Show/Season 01', 'E01.mkv', `bt/${torrent.infoHash}/0`],
      ['Movies/Sample Show/Season 01', 'E02.mkv', `bt/${torrent.infoHash}/2`],
    ])
    const events = await timeline(ctx.app, b.headers, task.id)
    expect(events.map((event) => event.action)).toContain('download_task_cache_hit')
    expect(events.find((event) => event.action === 'download_task_cache_hit')?.title).toBe(
      'Completed from the torrent cache',
    )
  })

  it('joins a torrent that is still downloading and completes when it is ready [spec: torrent-cache/join-in-progress]', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [filler] = await poll()
    const register = await ctx.app.request(`/api/downloads/tasks/${filler.id}/torrent`, {
      method: 'PUT',
      headers: bearer(filler.status.assignment?.uploadToken as string),
      body: JSON.stringify({ info: torrent.infoBase64 }),
    })
    expect(register.status).toBe(200)

    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    expect(joined.status.state).toBe('queued')
    expect((await timeline(ctx.app, b.headers, joined.id)).map((event) => event.title)).toContain(
      'Joined a download already in progress',
    )
    // No second download: the joined task is never assigned.
    expect((await poll()).map((task) => task.id)).toEqual([filler.id])

    await fillCache(ctx.app, filler, torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    expect((await getTask(ctx.app, b.headers, joined.id)).status.state).toBe('completed')
    expect((await driveFiles(ctx.db, b.orgId)).map((file) => file.object)).toEqual([
      `bt/${torrent.infoHash}/0`,
      `bt/${torrent.infoHash}/2`,
    ])
  })

  it('releases joined tasks when the filling download stops, and the next download takes the torrent over', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [filler] = await poll()
    const register = await ctx.app.request(`/api/downloads/tasks/${filler.id}/torrent`, {
      method: 'PUT',
      headers: bearer(filler.status.assignment?.uploadToken as string),
      body: JSON.stringify({ info: torrent.infoBase64 }),
    })
    expect(register.status).toBe(200)
    const joined = await submit(ctx.app, b.headers, torrent.magnet)
    expect(joined.status.state).toBe('queued')

    await ctx.deps.downloadTasks.setFields(filler.id, {
      status: 'failed',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    const [takeover] = await poll()
    expect(takeover.id).toBe(joined.id)
    expect(takeover.status.assignment?.torrentCache).toBe(true)

    const completed = await fillCache(ctx.app, takeover, torrent)
    expect(completed.status.state).toBe('completed')
    const [row] = await ctx.db.all<{ sourceTaskId: string }>(sql`
      SELECT source_task_id AS sourceTaskId FROM torrents WHERE info_hash = ${torrent.infoHash}
    `)
    expect(row.sourceTaskId).toBe(joined.id)
  })

  it('assigns magnet tasks to downloaders without cache support exactly as before [spec: torrent-cache/legacy-downloader-unchanged]', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent'])
    const torrent = sampleTorrent()
    const submitted = await submit(ctx.app, a.headers, torrent.magnet)

    const [assigned] = await poll()
    expect(assigned.id).toBe(submitted.id)
    expect(Object.keys(assigned.status.assignment ?? {}).sort()).toEqual([
      'assignedAt',
      'downloaderId',
      'executor',
      'uploadToken',
    ])
    const token = assigned.status.assignment?.uploadToken as string

    // The cache API refuses it; the object API takes its upload into the drive.
    const register = await ctx.app.request(`/api/downloads/tasks/${assigned.id}/torrent`, {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify({ info: torrent.infoBase64 }),
    })
    expect(register.status).toBe(409)
    const created = await ctx.app.request('/api/objects', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ name: 'E01.mkv', type: 'video/x-matroska', size: 70_000, parent: 'Downloads' }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { object?: { id: string } }
    const [row] = await ctx.db.all<{ object: string }>(sql`SELECT object FROM matters WHERE name = 'E01.mkv'`)
    expect(row.object.startsWith('bt/')).toBe(false)
    expect(body).toBeTruthy()
    expect(await ctx.db.all(sql`SELECT id FROM torrents`)).toEqual([])
  })
  it('takes a drive upload from a cache-mode task whose downloader fell back before registering', async () => {
    const { ctx, a } = await setup()
    const capabilities = ['magnet', 'torrent', 'torrent-cache']
    const created = await createDownloader(
      ctx.deps,
      ctx.platform,
      { name: 'dl-fallback', heartbeat: { ...heartbeat, capabilities } },
      a.userId,
    )
    const downloaderHeaders = bearer(created.token)
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const beat = await ctx.app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, capabilities }),
    })
    const [assigned] = ((await beat.json()) as { assignments: DownloadTask[] }).assignments
    const [role] = await ctx.db.all<{ torrent_cache_role: string | null }>(
      sql`SELECT torrent_cache_role FROM download_tasks WHERE id = ${assigned.id}`,
    )
    expect(role.torrent_cache_role).toBe('fill')

    // The engine never handed over metadata, so the downloader uploads into the drive.
    const token = assigned.status.assignment?.uploadToken as string
    const object = await ctx.app.request('/api/objects', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ name: 'E01.mkv', type: 'video/x-matroska', size: 70_000, parent: 'Downloads' }),
    })
    expect(object.status).toBe(201)
    const { id: objectId } = (await object.json()) as { id: string }
    const completed = await ctx.app.request(`/api/downloads/tasks/${assigned.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'completed', resultObjectId: objectId }),
    })
    expect(completed.status).toBe(200)
    expect((await getTask(ctx.app, a.headers, assigned.id)).status.state).toBe('completed')
    expect(await ctx.db.all(sql`SELECT id FROM torrents`)).toEqual([])
  })
})

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

async function register(app: TestApp['app'], task: DownloadTask, info: string) {
  const res = await app.request(`/api/downloads/tasks/${task.id}/torrent`, {
    method: 'PUT',
    headers: bearer(task.status.assignment?.uploadToken as string),
    body: JSON.stringify({ info }),
  })
  return { status: res.status, body: (await res.json()) as { outcome?: string; error?: { details?: unknown } } }
}

async function readyTorrent(ctx: TestApp, a: { headers: Record<string, string> }, poll: () => Promise<DownloadTask[]>) {
  const torrent = sampleTorrent()
  await submit(ctx.app, a.headers, torrent.magnet)
  await fillCache(ctx.app, (await poll())[0], torrent)
  await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
  return torrent
}

describe('torrent cache fill edge cases', () => {
  it('verifies a sample within the completing request when no queue runs', async () => {
    const { ctx, a } = await setup({ ZPAN_ARCHIVE_JOBS_ENABLED: 'false' })
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const completed = await fillCache(ctx.app, (await poll())[0], torrent)

    expect(completed.status.state).toBe('completed')
    expect(await torrentStatus(ctx.db, torrent.infoHash)).toMatchObject({ status: 'ready', verified: 'sampled' })
    const [job] = await ctx.db.all<{ status: string }>(
      sql`SELECT status FROM background_jobs WHERE type = 'torrent_verify'`,
    )
    expect(job.status).toBe('completed')
  })

  it('completes, joins, or sends a torrent_url task to the drive when it registers', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const ready = await readyTorrent(ctx, a, poll)

    // Ready: the registering task completes from the cache.
    await submitTorrentUrl(ctx.app, b.headers)
    const [first] = await poll()
    expect((await register(ctx.app, first, ready.infoBase64)).body.outcome).toBe('completed')
    expect((await getTask(ctx.app, b.headers, first.id)).status.state).toBe('completed')

    // Downloading by another task: it joins.
    const other = sampleTorrent('Other')
    await submit(ctx.app, a.headers, other.magnet)
    const [filler] = await poll()
    expect((await register(ctx.app, filler, other.infoBase64)).body.outcome).toBe('fill')
    await submitTorrentUrl(ctx.app, b.headers)
    const second = (await poll()).find((task) => task.id !== filler.id) as DownloadTask
    expect((await register(ctx.app, second, other.infoBase64)).body.outcome).toBe('joined')
    expect((await getTask(ctx.app, b.headers, second.id)).status.state).toBe('queued')

    // Invalid: the task uploads into the drive instead.
    const bad = sampleTorrent('Bad')
    await submit(ctx.app, a.headers, bad.magnet)
    const [badFiller] = (await poll()).filter((task) => task.id !== filler.id)
    expect((await register(ctx.app, badFiller, bad.infoBase64)).body.outcome).toBe('fill')
    await ctx.db.run(sql`UPDATE torrents SET status = 'invalid' WHERE info_hash = ${bad.infoHash}`)
    await submitTorrentUrl(ctx.app, b.headers)
    const third = (await poll()).find((task) => ![filler.id, badFiller.id].includes(task.id)) as DownloadTask
    expect((await register(ctx.app, third, bad.infoBase64)).body.outcome).toBe('drive')
  })

  it('refuses bad registrations, uploads, and completions', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = sampleTorrent()
    await submitTorrentUrl(ctx.app, a.headers)
    const [task] = await poll()
    const headers = bearer(task.status.assignment?.uploadToken as string)
    const garbage = Buffer.from('not bencode').toString('base64')
    expect(await register(ctx.app, task, garbage)).toMatchObject({ status: 400 })
    expect(await register(ctx.app, task, 'AAAA')).toMatchObject({ status: 400 })
    const otherTask = await ctx.app.request('/api/downloads/tasks/someOtherTaskId0000000/torrent', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ info: torrent.infoBase64 }),
    })
    expect(otherTask.status).toBe(403)
    expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')
    // Registering again continues the same fill.
    expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')

    const missing = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/1/uploads`, {
      method: 'POST',
      headers,
    })
    expect(missing.status).toBe(404) // fileIdx 1 is a padding file
    const plan = (await (
      await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/0/uploads`, { method: 'POST', headers })
    ).json()) as { parts: Array<{ url: string }> }
    upload(plan.parts[0].url, new Uint8Array(10))
    const wrongSize = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/0/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    expect(wrongSize.status).toBe(400)

    const complete = (files: Array<{ path: string; size: number }>) =>
      ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files }),
      })
    expect((await complete([{ path: 'Season 01/E01.mkv', size: 70_000 }])).status).toBe(400)
    const notUploaded = await complete([
      { path: 'Season 01/E01.mkv', size: 70_000 },
      { path: 'Season 01/E02.mkv', size: 33_000 },
    ])
    expect(notUploaded.status).toBe(400)
    expect(await notUploaded.json()).toMatchObject({ error: { details: [{ reason: 'TORRENT_FILES_MISSING' }] } })
  })

  it('uploads large files through multipart uploads', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
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
    const [task] = await poll()
    expect((await register(ctx.app, task, Buffer.from(info).toString('base64'))).body.outcome).toBe('fill')
    const headers = bearer(task.status.assignment?.uploadToken as string)
    const plan = (await (
      await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/0/uploads`, { method: 'POST', headers })
    ).json()) as {
      uploadId: string
      partSize: number
      parts: Array<{ partNumber: number; url: string; length: number }>
    }
    expect(plan.uploadId).toBeTruthy()
    expect(plan.parts.map((part) => part.length)).toEqual([64 * 1024 * 1024, 36 * 1024 * 1024])
    for (const part of plan.parts) upload(part.url, new Uint8Array(part.length))
    const complete = (body: unknown) =>
      ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/0/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    expect((await complete({ uploadId: plan.uploadId })).status).toBe(400)
    const done = await complete({
      uploadId: plan.uploadId,
      parts: plan.parts.map((part) => ({ partNumber: part.partNumber, etag: 'e' })),
    })
    expect(done.status).toBe(200)

    // A multipart upload whose parts failed is aborted, deleting its parts.
    const aborted: string[] = []
    vi.spyOn(S3Service.prototype, 'abortMultipartUpload').mockImplementation(async (_s, key, uploadId) => {
      aborted.push(`${key} ${uploadId}`)
      multipart.delete(uploadId)
    })
    const retry = (await (
      await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/files/0/uploads`, { method: 'POST', headers })
    ).json()) as { uploadId: string }
    const abort = await ctx.app.request(
      `/api/downloads/tasks/${task.id}/torrent/files/0/uploads/${encodeURIComponent(retry.uploadId)}`,
      { method: 'DELETE', headers },
    )
    expect(abort.status).toBe(204)
    // The memory bucket names an upload after its key, so the id holds a slash.
    const key = retry.uploadId.replace(/^mp:/, '')
    expect(key).toMatch(/^bt\/[0-9a-f]{40}\/0$/)
    expect(aborted).toEqual([`${key} ${retry.uploadId}`])
  })

  it('fails a submit that the cached torrent does not fit into', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = await readyTorrent(ctx, a, poll)
    await ctx.db.run(sql`UPDATE org_quota_entitlements SET bytes = 1000 WHERE org_id = ${b.orgId}`)
    await ctx.db.run(sql`UPDATE org_quotas SET quota = 1000 WHERE org_id = ${b.orgId}`)

    const task = await submit(ctx.app, b.headers, torrent.magnet)
    expect(task.status.state).toBe('failed')
    expect(task.status.error?.code).toBe('QUOTA_EXCEEDED')
  })

  it('settles joined tasks on the next heartbeat when the torrent turned ready or invalid elsewhere', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const good = sampleTorrent('Good')
    const bad = sampleTorrent('Bad')
    for (const torrent of [good, bad]) {
      await submit(ctx.app, a.headers, torrent.magnet)
    }
    const assigned = await poll()
    const fillers = [good, bad].map(
      (torrent) => assigned.find((task) => task.spec.source.uri === torrent.magnet) as DownloadTask,
    )
    for (const [index, torrent] of [good, bad].entries()) {
      expect((await register(ctx.app, fillers[index], torrent.infoBase64)).body.outcome).toBe('fill')
    }
    const joinedGood = await submit(ctx.app, b.headers, good.magnet)
    const joinedBad = await submit(ctx.app, b.headers, bad.magnet)
    // Verification finished without the usual hand-off (as after a crash).
    await ctx.db.run(sql`UPDATE torrents SET status = 'ready', verified = 'full' WHERE info_hash = ${good.infoHash}`)
    await ctx.db.run(sql`UPDATE torrents SET status = 'invalid' WHERE info_hash = ${bad.infoHash}`)
    await ctx.db.run(
      sql`UPDATE download_tasks SET status = 'completed' WHERE id IN (${fillers[0].id}, ${fillers[1].id})`,
    )

    await poll()
    expect((await getTask(ctx.app, b.headers, joinedGood.id)).status.state).toBe('completed')
    expect((await getTask(ctx.app, b.headers, joinedBad.id)).status).toMatchObject({
      state: 'failed',
      error: { message: 'The cached download failed verification' },
    })
  })
})

// ─── Sidecars and the upload layout ──────────────────────────────────────────

const SHOW = 'Show (2019)'
const SEASON = `${SHOW}/Season 01`
const E01 = `${SEASON}/Show.S01E01.1080p.mkv`
const E02 = `${SEASON}/Show.S01E02.1080p.mkv`

function scrapedTorrent() {
  return buildTorrent('Show.S01.1080p', [
    { path: 'Show.S01E01.1080p.mkv', bytes: fileBytes(40_000, 3) },
    { path: '.pad/24000', bytes: new Uint8Array(24_000), padding: true },
    { path: 'Show.S01E02.1080p.mkv', bytes: fileBytes(20_000, 4) },
  ])
}

// The sidecars the scraper wrote, by number, and where the plan put them.
const SIDECARS = [
  { n: 0, path: `${SHOW}/tvshow.nfo`, bytes: new TextEncoder().encode('<tvshow/>') },
  { n: 1, path: `${SHOW}/poster.jpg`, bytes: fileBytes(300, 5) },
  { n: 2, path: `${SEASON}/Show.S01E01.1080p.nfo`, bytes: new TextEncoder().encode('<episodedetails/>'), video: E01 },
  { n: 3, path: `${SEASON}/Show.S01E01.1080p-thumb.jpg`, bytes: fileBytes(200, 6), video: E01 },
]

const SIDECAR_BYTES = SIDECARS.reduce((sum, sidecar) => sum + sidecar.bytes.length, 0)

const LAYOUT = {
  version: 1,
  entries: [
    {
      kind: 'folder',
      path: SHOW,
      media: {
        kind: 'tvshow',
        tmdb: { id: 1399, type: 'tv' },
        title: 'Show',
        year: 2019,
        poster: `${SHOW}/poster.jpg`,
      },
    },
    { kind: 'folder', path: SEASON },
    {
      kind: 'torrent-file',
      path: E01,
      fileIdx: 0,
      media: {
        kind: 'episode',
        tmdb: { id: 1399, type: 'tv' },
        season: 1,
        episode: 1,
        title: 'Pilot',
        still: SIDECARS[3].path,
      },
    },
    { kind: 'torrent-file', path: E02, fileIdx: 2 },
    ...SIDECARS.map((sidecar) => ({
      kind: 'sidecar',
      path: sidecar.path,
      sidecar: sidecar.n,
      ...(sidecar.video ? { video: sidecar.video } : {}),
    })),
  ],
}

async function uploadSidecars(app: TestApp['app'], task: DownloadTask, sidecars = SIDECARS) {
  const headers = bearer(task.status.assignment?.uploadToken as string)
  for (const sidecar of sidecars) {
    const start = await app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/${sidecar.n}/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ size: sidecar.bytes.length }),
    })
    expect(start.status).toBe(201)
    const plan = (await start.json()) as { parts: Array<{ url: string }> }
    upload(plan.parts[0].url, sidecar.bytes)
    const done = await app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/${sidecar.n}/completions`, {
      method: 'POST',
      headers,
    })
    expect(done.status).toBe(200)
  }
}

function putLayout(app: TestApp['app'], task: DownloadTask, layout: unknown) {
  return app.request(`/api/downloads/tasks/${task.id}/torrent/layout`, {
    method: 'PUT',
    headers: bearer(task.status.assignment?.uploadToken as string),
    body: JSON.stringify(layout),
  })
}

// The drive under a folder: every live entry with its media, image references
// shown as the path of the matter they name.
async function tree(db: TestApp['db'], orgId: string, root: string) {
  const rows = await db.all<{ id: string; name: string; parent: string; object: string; metadata: string | null }>(sql`
    SELECT id, name, parent, object, metadata FROM matters
    WHERE org_id = ${orgId} AND purged_at IS NULL AND trashed_at IS NULL
      AND (parent = ${root} OR parent LIKE ${`${root}/%`})
    ORDER BY parent, name
  `)
  const pathOf = new Map(rows.map((row) => [row.id, `${row.parent}/${row.name}`]))
  return rows.map((row) => {
    const media = row.metadata ? (JSON.parse(row.metadata) as { media?: Record<string, unknown> }).media : undefined
    const resolved = media
      ? Object.fromEntries(
          Object.entries(media).map(([key, value]) =>
            ['poster', 'fanart', 'still'].includes(key)
              ? [key, pathOf.get(value as string) ?? 'missing']
              : [key, value],
          ),
        )
      : undefined
    return { path: `${row.parent}/${row.name}`, object: row.object, ...(resolved ? { media: resolved } : {}) }
  })
}

async function fillScraped(ctx: TestApp, task: DownloadTask, torrent: TorrentFixture) {
  expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')
  await uploadSidecars(ctx.app, task)
  expect((await putLayout(ctx.app, task, LAYOUT)).status).toBe(200)
  // fillCache registers again (continuing the same fill) and uploads the files.
  return fillCache(ctx.app, task, torrent)
}

describe('torrent cache layout', () => {
  it('replays the scraped layout for every holder [spec: torrent-cache/layout-replay]', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet, 'Downloads')
    const completed = await fillScraped(ctx, (await poll())[0], torrent)
    expect(completed.status.state).toBe('completed')
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    const bt = `bt/${torrent.infoHash}`
    const expected = (root: string) => [
      {
        path: `${root}/${SHOW}`,
        object: '',
        media: {
          kind: 'tvshow',
          tmdb: { id: 1399, type: 'tv' },
          title: 'Show',
          year: 2019,
          poster: `${root}/${SHOW}/poster.jpg`,
        },
      },
      { path: `${root}/${SHOW}/Season 01`, object: '' },
      { path: `${root}/${SHOW}/poster.jpg`, object: `${bt}/x/1` },
      { path: `${root}/${SHOW}/tvshow.nfo`, object: `${bt}/x/0` },
      { path: `${root}/${SIDECARS[3].path}`, object: `${bt}/x/3` },
      {
        path: `${root}/${E01}`,
        object: `${bt}/0`,
        media: {
          kind: 'episode',
          tmdb: { id: 1399, type: 'tv' },
          season: 1,
          episode: 1,
          title: 'Pilot',
          still: `${root}/${SIDECARS[3].path}`,
        },
      },
      { path: `${root}/${SIDECARS[2].path}`, object: `${bt}/x/2` },
      { path: `${root}/${E02}`, object: `${bt}/2` },
    ]
    // The first requester finishes through the same replay.
    expect(await tree(ctx.db, a.orgId, 'Downloads')).toEqual(expected('Downloads'))

    const task = await submit(ctx.app, b.headers, torrent.magnet, 'Media')
    expect(task.status.state).toBe('completed')
    expect(await tree(ctx.db, b.orgId, 'Media')).toEqual(expected('Media'))

    // The TV view lists the show with its episode, as it does after an upload.
    const shows = await ctx.app.request('/api/media/shows', { headers: b.headers })
    expect(shows.status).toBe(200)
    const page = (await shows.json()) as { items: Array<{ id: string; media: { title: string } }> }
    expect(page.items.map((item) => item.media.title)).toEqual(['Show'])
    const episodes = await ctx.app.request(`/api/media/shows/${page.items[0].id}/episodes`, { headers: b.headers })
    expect(episodes.status).toBe(200)
    const list = (await episodes.json()) as { items: Array<{ media: { episode: number } }> }
    expect(list.items.map((item) => item.media.episode)).toEqual([1])

    // Quota covers the files and sidecars; the storage counts the cached
    // objects once, layout included.
    const fileBytes = 60_000
    const [quota] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${b.orgId}`)
    expect(quota.used).toBe(fileBytes + SIDECAR_BYTES)
    const layoutBytes = (objects.get(`${bt}/layout.json`) as Uint8Array).length
    const [storage] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(fileBytes + SIDECAR_BYTES + layoutBytes)
  })

  it('reuses folders, keeps existing sidecars and media, and renames a taken video name', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    await fillScraped(ctx, (await poll())[0], torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    // Workspace b already holds the show folder with its own media and
    // tvshow.nfo, and a file at the first episode's name.
    const folder = async (name: string, parent: string) => {
      const res = await ctx.app.request('/api/objects', {
        method: 'POST',
        headers: b.headers,
        body: JSON.stringify({ name, type: 'folder', parent, dirtype: 1 }),
      })
      expect(res.status).toBe(201)
      return ((await res.json()) as { id: string }).id
    }
    await folder('Media', '')
    const show = await folder(SHOW, 'Media')
    await folder('Season 01', `Media/${SHOW}`)
    const existingMedia = { kind: 'tvshow', tmdb: { id: 7, type: 'tv' }, title: 'Earlier' }
    await ctx.db.run(sql`UPDATE matters SET metadata = ${JSON.stringify({ media: existingMedia })} WHERE id = ${show}`)
    const placeFile = async (name: string, parent: string) => {
      const res = await ctx.app.request('/api/objects', {
        method: 'POST',
        headers: b.headers,
        body: JSON.stringify({ name, type: 'application/octet-stream', size: 1, parent }),
      })
      expect(res.status).toBe(201)
      const id = ((await res.json()) as { id: string }).id
      await ctx.db.run(sql`UPDATE matters SET status = 'active' WHERE id = ${id}`)
      return id
    }
    const nfo = await placeFile('tvshow.nfo', `Media/${SHOW}`)
    await placeFile('Show.S01E01.1080p.mkv', `Media/${SEASON}`)

    const task = await submit(ctx.app, b.headers, torrent.magnet, 'Media')
    expect(task.status.state).toBe('completed')
    const entries = await tree(ctx.db, b.orgId, 'Media')
    const paths = entries.map((entry) => entry.path)
    // One show folder, one season folder: both reused.
    expect(paths.filter((path) => path === `Media/${SHOW}`)).toHaveLength(1)
    expect(paths.filter((path) => path === `Media/${SEASON}`)).toHaveLength(1)
    expect(entries.find((entry) => entry.path === `Media/${SHOW}`)?.media).toEqual(existingMedia)
    // The existing tvshow.nfo wins.
    const [kept] = await ctx.db.all<{ id: string; object: string }>(sql`
      SELECT id, object FROM matters WHERE org_id = ${b.orgId} AND parent = ${`Media/${SHOW}`} AND name = 'tvshow.nfo'
    `)
    expect(kept.id).toBe(nfo)
    expect(kept.object.startsWith('bt/')).toBe(false)
    // The taken video name is renamed, and its sidecars follow the new name.
    expect(entries.find((entry) => entry.path === `Media/${SEASON}/Show.S01E01.1080p (1).mkv`)).toMatchObject({
      object: `bt/${torrent.infoHash}/0`,
      media: { kind: 'episode', still: `Media/${SEASON}/Show.S01E01.1080p (1)-thumb.jpg` },
    })
    expect(paths).toContain(`Media/${SEASON}/Show.S01E01.1080p (1).nfo`)
  })

  it('refuses layouts that name files or sidecars the cache does not hold', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await poll()
    expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')
    await uploadSidecars(ctx.app, task, SIDECARS.slice(0, 1))

    const invalid = async (entries: unknown[]) => {
      const res = await putLayout(ctx.app, task, { version: 1, entries })
      expect(res.status).toBe(400)
      return res
    }
    // A padding file, a missing file, a sidecar never uploaded.
    expect(await (await invalid([{ kind: 'torrent-file', path: 'Show/pad', fileIdx: 1 }])).json()).toMatchObject({
      error: { details: [{ reason: 'TORRENT_LAYOUT_INVALID' }] },
    })
    await invalid([{ kind: 'torrent-file', path: 'Show/x.mkv', fileIdx: 9 }])
    await invalid([{ kind: 'sidecar', path: 'Show/poster.jpg', sidecar: 1 }])
    // The same file twice, a path twice, a file holding another entry.
    await invalid([
      { kind: 'torrent-file', path: 'a.mkv', fileIdx: 0 },
      { kind: 'torrent-file', path: 'b.mkv', fileIdx: 0 },
    ])
    await invalid([
      { kind: 'torrent-file', path: 'a.mkv', fileIdx: 0 },
      { kind: 'sidecar', path: 'A.mkv', sidecar: 0 },
    ])
    await invalid([
      { kind: 'torrent-file', path: 'a.mkv', fileIdx: 0 },
      { kind: 'sidecar', path: 'a.mkv/x.nfo', sidecar: 0 },
    ])
    // A sidecar named after something that is not its video, an image that is no sidecar.
    await invalid([
      { kind: 'torrent-file', path: 'a.mkv', fileIdx: 0 },
      { kind: 'sidecar', path: 'b.nfo', sidecar: 0, video: 'a.mkv' },
    ])
    await invalid([{ kind: 'sidecar', path: 'b.nfo', sidecar: 0, video: 'missing.mkv' }])
    await invalid([
      {
        kind: 'torrent-file',
        path: 'a.mkv',
        fileIdx: 0,
        media: { kind: 'movie', tmdb: { id: 1, type: 'movie' }, title: 'A', poster: 'a.mkv' },
      },
    ])
    // Path segments must be clean.
    await invalid([{ kind: 'torrent-file', path: '../a.mkv', fileIdx: 0 }])

    // Sidecars refuse oversized declarations and completions without an upload.
    const headers = bearer(task.status.assignment?.uploadToken as string)
    const big = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/5/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ size: 64 * 1024 * 1024 }),
    })
    expect(big.status).toBe(400)
    const notUploaded = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/5/completions`, {
      method: 'POST',
      headers,
    })
    expect(notUploaded.status).toBe(400)
  })

  it('evicts sidecars and the layout with the torrent, and a takeover starts without them', async () => {
    const { ctx, a } = await setup()
    const evicted: string[] = []
    vi.spyOn(S3Service.prototype, 'evictTorrentCacheObjects').mockImplementation(async (_s, keys) => {
      for (const key of keys) {
        evicted.push(key)
        objects.delete(key)
      }
    })
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [first] = await poll()
    expect((await register(ctx.app, first, torrent.infoBase64)).body.outcome).toBe('fill')
    await uploadSidecars(ctx.app, first)
    expect((await putLayout(ctx.app, first, LAYOUT)).status).toBe(200)

    // The first download stops; a new one takes the torrent over and clears
    // what the first one stored beside the files.
    await ctx.deps.downloadTasks.setFields(first.id, {
      status: 'failed',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    await submit(ctx.app, a.headers, torrent.magnet, 'Again')
    const takeover = (await poll()).find((task) => task.id !== first.id) as DownloadTask
    expect((await register(ctx.app, takeover, torrent.infoBase64)).body.outcome).toBe('fill')
    const bt = `bt/${torrent.infoHash}`
    expect(evicted.sort()).toEqual([`${bt}/layout.json`, `${bt}/x/0`, `${bt}/x/1`, `${bt}/x/2`, `${bt}/x/3`])
    expect(await ctx.db.all(sql`SELECT name FROM torrent_extra_objects`)).toEqual([])

    // Without a layout, the takeover lays the torrent out as its own tree.
    await uploadSidecars(ctx.app, takeover, SIDECARS.slice(1, 2))
    await fillCache(ctx.app, takeover, torrent)
    expect((await tree(ctx.db, a.orgId, 'Again')).map((entry) => entry.path)).toEqual([
      'Again/Show.S01.1080p',
      'Again/Show.S01.1080p/Show.S01E01.1080p.mkv',
      'Again/Show.S01.1080p/Show.S01E02.1080p.mkv',
    ])
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    // Eviction deletes the files, the remaining sidecar, and the extra rows.
    evicted.length = 0
    await ctx.db.run(sql`UPDATE matters SET purged_at = ${Date.now()} WHERE object LIKE 'bt/%'`)
    await ctx.db.run(sql`UPDATE torrents SET last_accessed_at = 0`)
    const { evictTorrentCache } = await import('../../usecases/torrent-cache/eviction.js')
    expect(await evictTorrentCache(ctx.deps)).toBe(1)
    expect(evicted.sort()).toEqual([`${bt}/0`, `${bt}/2`, `${bt}/info`, `${bt}/layout.json`, `${bt}/x/1`])
    expect(await ctx.db.all(sql`SELECT name FROM torrent_extra_objects`)).toEqual([])
    const [storage] = await ctx.db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(0)
  })
})

describe('torrent cache layout fallback', () => {
  it('lays out the torrent as its own tree when the stored layout cannot be read', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    await fillScraped(ctx, (await poll())[0], torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')

    objects.set(`bt/${torrent.infoHash}/layout.json`, new TextEncoder().encode('{not json'))
    expect((await submit(ctx.app, b.headers, torrent.magnet, 'Media')).status.state).toBe('completed')
    expect((await tree(ctx.db, b.orgId, 'Media')).map((entry) => entry.path)).toEqual([
      'Media/Show.S01.1080p',
      'Media/Show.S01.1080p/Show.S01E01.1080p.mkv',
      'Media/Show.S01.1080p/Show.S01E02.1080p.mkv',
    ])
  })
})

describe('torrent cache layout hardening', () => {
  it('lays out the raw tree only when the layout object is gone, and fails a transfer when the read fails', async () => {
    const { ctx, a, b } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    await fillScraped(ctx, (await poll())[0], torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    const layoutKey = `bt/${torrent.infoHash}/layout.json`

    // A transient read failure is not a verdict on the layout: nothing is laid out.
    const read = vi.mocked(S3Service.prototype.getObjectBytes)
    const original = read.getMockImplementation()
    read.mockImplementation(async (storage, key, range) => {
      if (key === layoutKey) throw new Error('S3 object read failed: 503')
      return (original as NonNullable<typeof original>)(storage, key, range)
    })
    const failed = await ctx.app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: b.headers,
      body: JSON.stringify({ source: { type: 'magnet', uri: torrent.magnet }, targetFolder: 'Media' }),
    })
    expect(failed.status).toBeGreaterThanOrEqual(500)
    expect(await tree(ctx.db, b.orgId, 'Media')).toEqual([])

    // Once the read works, the same transfer replays the layout.
    read.mockImplementation(original as NonNullable<typeof original>)
    expect((await submit(ctx.app, b.headers, torrent.magnet, 'Media')).status.state).toBe('completed')
    expect((await tree(ctx.db, b.orgId, 'Media')).map((entry) => entry.path)).toContain(`Media/${E01}`)

    // A layout object that no longer exists does degrade to the raw tree.
    objects.delete(layoutKey)
    expect((await submit(ctx.app, b.headers, torrent.magnet, 'Raw')).status.state).toBe('completed')
    expect((await tree(ctx.db, b.orgId, 'Raw')).map((entry) => entry.path)).toEqual([
      'Raw/Show.S01.1080p',
      'Raw/Show.S01.1080p/Show.S01E01.1080p.mkv',
      'Raw/Show.S01.1080p/Show.S01E02.1080p.mkv',
    ])
  })

  it('refuses a layout body over 8 MiB', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await poll()
    expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')
    const path = 'a'.repeat(4000)
    const entries = Array.from({ length: 2200 }, (_, i) => ({ kind: 'folder', path: `${path}/${i}` }))
    const res = await putLayout(ctx.app, task, { version: 1, entries })
    expect(res.status).toBe(413)
    expect(objects.has(`bt/${torrent.infoHash}/layout.json`)).toBe(false)
  })

  it('deletes an oversized sidecar, and eviction removes objects no row records', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [task] = await poll()
    expect((await register(ctx.app, task, torrent.infoBase64)).body.outcome).toBe('fill')
    const bt = `bt/${torrent.infoHash}`

    // The declared size was small, but the PUT stored more than the cap.
    const headers = bearer(task.status.assignment?.uploadToken as string)
    const start = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/7/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ size: 10 }),
    })
    expect(start.status).toBe(201)
    upload(((await start.json()) as { parts: Array<{ url: string }> }).parts[0].url, new Uint8Array(33 * 1024 * 1024))
    const done = await ctx.app.request(`/api/downloads/tasks/${task.id}/torrent/sidecars/7/completions`, {
      method: 'POST',
      headers,
    })
    expect(done.status).toBe(400)
    expect(objects.has(`${bt}/x/7`)).toBe(false)

    await fillCache(ctx.app, task, torrent)
    await waitForTorrent(ctx.db, torrent.infoHash, 'ready')
    // A late presigned PUT lands after the download stopped; no row records it.
    objects.set(`${bt}/x/8`, new Uint8Array(5))
    await ctx.db.run(sql`UPDATE matters SET purged_at = ${Date.now()} WHERE object LIKE 'bt/%'`)
    await ctx.db.run(sql`UPDATE torrents SET last_accessed_at = 0`)
    const { evictTorrentCache } = await import('../../usecases/torrent-cache/eviction.js')
    expect(await evictTorrentCache(ctx.deps)).toBe(1)
    expect([...objects.keys()].filter((key) => key.startsWith(`${bt}/`))).toEqual([])
  })

  it('retries a takeover whose clear failed, and recounts storage usage without the cleared objects', async () => {
    const { ctx, a } = await setup()
    const poll = await downloader(ctx, a.userId, ['magnet', 'torrent', 'torrent-cache'])
    const torrent = scrapedTorrent()
    await submit(ctx.app, a.headers, torrent.magnet)
    const [first] = await poll()
    expect((await register(ctx.app, first, torrent.infoBase64)).body.outcome).toBe('fill')
    await uploadSidecars(ctx.app, first)
    expect((await putLayout(ctx.app, first, LAYOUT)).status).toBe(200)
    await ctx.deps.storageUsage.reconcileStorages([STORAGE_ID])
    const used = async () =>
      (await ctx.db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`))[0].used
    const layoutBytes = objects.get(`bt/${torrent.infoHash}/layout.json`)?.length ?? 0
    const fileBytesTotal = torrent.files.filter((file) => !file.padding).reduce((sum, f) => sum + f.bytes.length, 0)
    expect(await used()).toBe(fileBytesTotal + SIDECAR_BYTES + layoutBytes)

    await ctx.deps.downloadTasks.setFields(first.id, {
      status: 'failed',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    await submit(ctx.app, a.headers, torrent.magnet, 'Again')
    const takeover = (await poll()).find((task) => task.id !== first.id) as DownloadTask

    // The clear fails once: the torrent still names the stopped download.
    const evict = vi.mocked(S3Service.prototype.evictTorrentCacheObjects)
    const original = evict.getMockImplementation() as NonNullable<ReturnType<typeof evict.getMockImplementation>>
    evict.mockImplementationOnce(async () => {
      throw new Error('S3 delete failed: 503')
    })
    expect((await register(ctx.app, takeover, torrent.infoBase64)).status).toBeGreaterThanOrEqual(500)
    const [source] = await ctx.db.all<{ source_task_id: string }>(
      sql`SELECT source_task_id FROM torrents WHERE info_hash = ${torrent.infoHash}`,
    )
    expect(source.source_task_id).toBe(first.id)

    // The retry takes over and clears what the first download stored.
    evict.mockImplementation(original)
    expect((await register(ctx.app, takeover, torrent.infoBase64)).body.outcome).toBe('fill')
    expect(await ctx.db.all(sql`SELECT name FROM torrent_extra_objects`)).toEqual([])
    expect([...objects.keys()].filter((key) => key.includes('/x/') || key.endsWith('layout.json'))).toEqual([])
    expect(await used()).toBe(fileBytesTotal)
  })
})
