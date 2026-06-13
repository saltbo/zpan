import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARCHIVE_QUEUE_BINDING, createArchiveJobsGateway } from '../adapters/gateways/archive-jobs'
import { S3Service } from '../adapters/gateways/s3'
import { createBackgroundJobRepo } from '../adapters/repos/background-job'
import { authedHeaders, createTestApp } from '../test/setup.js'
import type { ArchiveJobMessage } from '../usecases/ports'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

type UserOrg = {
  userId: string
  orgId: string
}

async function getUserOrg(db: TestDb, email: string): Promise<UserOrg> {
  const rows = await db.all<UserOrg>(sql`
    SELECT u.id AS userId, m.organization_id AS orgId
    FROM user u
    INNER JOIN member m ON m.user_id = u.id
    WHERE u.email = ${email}
    LIMIT 1
  `)
  if (!rows[0]) throw new Error(`No user org found for ${email}`)
  return rows[0]
}

describe('background jobs API', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates archive jobs through POST and completes them after the response [spec: background-jobs/create-and-complete]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-create@example.com')
    const { orgId } = await getUserOrg(db, 'jobs-create@example.com')
    await seedStorage(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('route-zip', ${orgId}, 'route-zip-alias', 'route.zip', 'application/zip', 200, 0, '', 'route/source.zip', 'route-storage', 'active', ${now}, ${now})
    `)

    const objectStore = new Map<string, Uint8Array>([['route/source.zip', createZip({ 'route.txt': bytes('ok') })]])
    const putKeys: string[] = []
    vi.spyOn(S3Service.prototype, 'headObject').mockImplementation(async (_storage, key) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return { size: bytes.byteLength, contentType: 'application/zip' }
    })
    vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_storage, key, range) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return range ? sliceRange(bytes, range) : bytes
    })
    vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(async (_storage, key) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    })
    vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
      objectStore.set(key, bytes)
      putKeys.push(key)
      return bytes.byteLength
    })

    const res = await app.request('/api/background-jobs', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'archive_extract', matterId: 'route-zip' }),
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string }
    expect(created).toMatchObject({
      orgId,
      type: 'archive_extract',
      status: 'queued',
    })
    const completed = await waitForJob(db, orgId, created.id, 'completed')
    expect(completed).toMatchObject({
      orgId,
      type: 'archive_extract',
      status: 'completed',
      progress: { outputBytes: 2, fileCount: 1 },
    })
    expect(putKeys).toHaveLength(1)
  })

  it('dispatches archive jobs to Cloudflare Queue bindings and lets the consumer complete them [spec: background-jobs/queue-dispatch]', async () => {
    const messages: ArchiveJobMessage[] = []
    const queue = { send: async (message: ArchiveJobMessage) => messages.push(message) }
    const { app, db, platform } = await createTestApp({}, { [ARCHIVE_QUEUE_BINDING]: queue })
    const headers = await authedHeaders(app, 'jobs-queue@example.com')
    const { orgId } = await getUserOrg(db, 'jobs-queue@example.com')
    await seedStorage(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('queue-zip', ${orgId}, 'queue-zip-alias', 'queue.zip', 'application/zip', 200, 0, '', 'queue/source.zip', 'route-storage', 'active', ${now}, ${now})
    `)

    const objectStore = new Map<string, Uint8Array>([['queue/source.zip', createZip({ 'queue.txt': bytes('ok') })]])
    vi.spyOn(S3Service.prototype, 'headObject').mockImplementation(async (_storage, key) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return { size: bytes.byteLength, contentType: 'application/zip' }
    })
    vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_storage, key, range) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return range ? sliceRange(bytes, range) : bytes
    })
    vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(async (_storage, key) => {
      const bytes = objectStore.get(key)
      if (!bytes) throw new Error(`missing ${key}`)
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    })
    vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
      objectStore.set(key, bytes)
      return bytes.byteLength
    })

    const res = await app.request('/api/background-jobs', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'archive_extract', matterId: 'queue-zip' }),
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; status: string }
    expect(created.status).toBe('queued')
    expect(messages).toHaveLength(1)
    await expect(createBackgroundJobRepo(db).get(orgId, created.id)).resolves.toMatchObject({ status: 'queued' })

    await createArchiveJobsGateway(platform).runMessage(messages[0])

    await expect(createBackgroundJobRepo(db).get(orgId, created.id)).resolves.toMatchObject({
      status: 'completed',
      progress: { outputBytes: 2, fileCount: 1 },
    })
  })

  it('returns a failed archive job for a missing explicit target folder [spec: background-jobs/missing-target]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-missing-target@example.com')
    const { orgId } = await getUserOrg(db, 'jobs-missing-target@example.com')
    await seedStorage(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('route-file', ${orgId}, 'route-file-alias', 'file.txt', 'text/plain', 5, 0, '', 'route/file.txt', 'route-storage', 'active', ${now}, ${now})
    `)

    const res = await app.request('/api/background-jobs', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'archive_compress', matterIds: ['route-file'], targetFolder: 'missing' }),
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string }
    expect(created).toMatchObject({
      orgId,
      type: 'archive_compress',
      status: 'queued',
      errorMessage: null,
    })
    const failed = await waitForJob(db, orgId, created.id, 'failed')
    expect(failed).toMatchObject({
      orgId,
      type: 'archive_compress',
      status: 'failed',
      errorMessage: 'Target folder not found',
    })
  })

  it('returns a failed archive job when explicit target folder points to a file [spec: background-jobs/target-is-file]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-file-target@example.com')
    const { orgId } = await getUserOrg(db, 'jobs-file-target@example.com')
    await seedStorage(db)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('route-zip-target', ${orgId}, 'route-zip-target-alias', 'route.zip', 'application/zip', 200, 0, '', 'route/source.zip', 'route-storage', 'active', ${now}, ${now})
    `)
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('route-file-target', ${orgId}, 'route-file-target-alias', 'target.txt', 'text/plain', 1, 0, '', 'route/target.txt', 'route-storage', 'active', ${now}, ${now})
    `)

    const res = await app.request('/api/background-jobs', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'archive_extract', matterId: 'route-zip-target', targetFolder: 'target.txt' }),
    })

    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string }
    expect(created).toMatchObject({
      orgId,
      type: 'archive_extract',
      status: 'queued',
      errorMessage: null,
    })
    const failed = await waitForJob(db, orgId, created.id, 'failed')
    expect(failed).toMatchObject({
      orgId,
      type: 'archive_extract',
      status: 'failed',
      errorMessage: 'Target folder must be a folder',
    })
  })

  it('lists current org jobs with status/type filters and pagination [spec: background-jobs/list-filter]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-list@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-list@example.com')
    await createBackgroundJobRepo(db).create({ orgId, userId, type: 'archive_compress' })
    const running = await createBackgroundJobRepo(db).create({ orgId, userId, type: 'archive_extract' })
    await createBackgroundJobRepo(db).update(orgId, running.id, { status: 'running' })

    const res = await app.request('/api/background-jobs?status=running&type=archive_extract&page=1&pageSize=1', {
      headers,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      items: [{ id: running.id, orgId, type: 'archive_extract', status: 'running' }],
    })
  })

  it('rejects detail access across organizations [spec: background-jobs/cross-org-guard]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app, 'jobs-owner@example.com')
    const viewerHeaders = await authedHeaders(app, 'jobs-viewer@example.com')
    const owner = await getUserOrg(db, 'jobs-owner@example.com')
    const job = await createBackgroundJobRepo(db).create({
      orgId: owner.orgId,
      userId: owner.userId,
      type: 'archive_compress',
    })

    const res = await app.request(`/api/background-jobs/${job.id}`, { headers: viewerHeaders })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('cancels only queued or running jobs [spec: background-jobs/cancel]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-cancel@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-cancel@example.com')
    const queued = await createBackgroundJobRepo(db).create({ orgId, userId, type: 'archive_compress' })
    const completed = await createBackgroundJobRepo(db).create({ orgId, userId, type: 'archive_extract' })
    await createBackgroundJobRepo(db).update(orgId, completed.id, { status: 'completed' })

    const canceledRes = await app.request(`/api/background-jobs/${queued.id}/cancel`, { method: 'POST', headers })
    const rejectedRes = await app.request(`/api/background-jobs/${completed.id}/cancel`, { method: 'POST', headers })

    expect(canceledRes.status).toBe(200)
    await expect(canceledRes.json()).resolves.toMatchObject({ id: queued.id, status: 'canceled' })
    expect(rejectedRes.status).toBe(409)
    await expect(rejectedRes.json()).resolves.toEqual({ error: 'Background job cannot be canceled' })
  })

  it('retries only failed retryable jobs without hiding the failed job [spec: background-jobs/retry]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-retry@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-retry@example.com')
    const retryable = await createBackgroundJobRepo(db).create({
      orgId,
      userId,
      type: 'archive_extract',
      targetPath: '/imports/archive.zip',
      retryable: true,
    })
    const notFailed = await createBackgroundJobRepo(db).create({
      orgId,
      userId,
      type: 'archive_compress',
      retryable: true,
    })
    await createBackgroundJobRepo(db).update(orgId, retryable.id, {
      status: 'failed',
      errorMessage: 'zip_crc_error',
      progress: { inputBytes: 128, fileCount: 4 },
    })

    const retryRes = await app.request(`/api/background-jobs/${retryable.id}/retry`, { method: 'POST', headers })
    const rejectedRes = await app.request(`/api/background-jobs/${notFailed.id}/retry`, { method: 'POST', headers })

    expect(retryRes.status).toBe(201)
    const retried = (await retryRes.json()) as { id: string; retriedFromJobId: string; status: string }
    expect(retried).toMatchObject({ retriedFromJobId: retryable.id, status: 'queued' })
    expect(retried.id).not.toBe(retryable.id)
    expect(rejectedRes.status).toBe(409)
    await expect(rejectedRes.json()).resolves.toEqual({ error: 'Background job cannot be retried' })

    const original = await createBackgroundJobRepo(db).get(orgId, retryable.id)
    expect(original).toMatchObject({ status: 'failed', errorMessage: 'zip_crc_error', retriedFromJobId: null })
    await expect(createBackgroundJobRepo(db).cancel(orgId, retryable.id)).rejects.toMatchObject({
      code: 'not_cancelable',
    })
  })

  it('lets non-domain service errors surface at the route boundary [spec: background-jobs/error-surfacing]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-invalid-json@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-invalid-json@example.com')
    const job = await createBackgroundJobRepo(db).create({ orgId, userId, type: 'archive_compress' })
    await db.run(sql`UPDATE background_jobs SET metadata = '{invalid-json' WHERE id = ${job.id}`)

    const res = await app.request(`/api/background-jobs/${job.id}`, { headers })

    expect(res.status).toBe(500)
  })
})

async function seedStorage(db: TestDb): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('route-storage', 'Route Storage', 'private', 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function waitForJob(
  db: TestDb,
  orgId: string,
  jobId: string,
  status: 'completed' | 'failed',
): Promise<Awaited<ReturnType<ReturnType<typeof createBackgroundJobRepo>['get']>>> {
  for (let i = 0; i < 20; i++) {
    const job = await createBackgroundJobRepo(db).get(orgId, jobId)
    if (job.status === status) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Job ${jobId} did not reach ${status}`)
}

function createZip(files: Record<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [name, data] of Object.entries(files)) {
    const filename = encoder.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + filename.length + data.length)
    write32(local, 0, 0x04034b50)
    write16(local, 6, 0x0800)
    write32(local, 14, crc)
    write32(local, 18, data.length)
    write32(local, 22, data.length)
    write16(local, 26, filename.length)
    local.set(filename, 30)
    local.set(data, 30 + filename.length)
    localParts.push(local)

    const central = new Uint8Array(46 + filename.length)
    write32(central, 0, 0x02014b50)
    write16(central, 8, 0x0800)
    write32(central, 16, crc)
    write32(central, 20, data.length)
    write32(central, 24, data.length)
    write16(central, 28, filename.length)
    write32(central, 42, offset)
    central.set(filename, 46)
    centralParts.push(central)
    offset += local.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  write32(eocd, 0, 0x06054b50)
  write16(eocd, 8, centralParts.length)
  write16(eocd, 10, centralParts.length)
  write32(eocd, 12, centralSize)
  write32(eocd, 16, offset)
  return concat([...localParts, ...centralParts, eocd])
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function sliceRange(bytes: Uint8Array, range: string): Uint8Array {
  const match = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (!match) throw new Error(`Unsupported range: ${range}`)
  return bytes.slice(Number(match[1]), Number(match[2]) + 1)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
