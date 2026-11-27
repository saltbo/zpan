import type { DownloadTask, DownloadTaskTimelineItem } from '@shared/types'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../../adapters/gateways/s3.js'
import { authedHeaders, createTestApp, seedProLicense } from '../../test/setup.js'
import { buildTorrent, fileBytes, type TorrentFixture } from '../../test/torrent-fixture.js'
import { createDownloader } from '../../usecases/downloads/downloads.js'

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
    if (!bytes) throw new Error('NoSuchKey')
    return bytes
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

async function setup() {
  const ctx = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
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
})
