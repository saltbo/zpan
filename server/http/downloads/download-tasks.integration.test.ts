import type { Downloader, DownloadTask, DownloadTaskTimelineItem } from '@shared/types'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../../adapters/gateways/s3.js'
import { remoteDownloadUsageReports } from '../../db/schema'
import { adminHeaders, authedHeaders, createTestApp, seedBusinessLicense, seedProLicense } from '../../test/setup.js'

type DownloadTaskList = { items: DownloadTask[] }

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'createMultipartUpload').mockResolvedValue('upload-1')
  vi.spyOn(S3Service.prototype, 'presignUploadPart').mockResolvedValue('https://presigned-part.example.com')
  vi.spyOn(S3Service.prototype, 'completeMultipartUpload').mockResolvedValue(undefined)
  // Single-PUT completion HEADs the object; return the etag the tests send.
  vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({ size: 0, contentType: 'text/plain', etag: 'etag-1' })
})

const heartbeat = {
  version: 'test-1.0.0',
  hostname: 'test-downloader',
  platform: 'darwin',
  arch: 'arm64',
  engine: 'aria2',
  capabilities: ['http', 'magnet', 'torrent'],
  maxConcurrentTasks: 2,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024 * 1024 * 1024,
}

function transferProgress(input: {
  downloadBytes?: number
  uploadBytes?: number
  totalBytes?: number | null
  downloadBps?: number
  uploadBps?: number
}) {
  return {
    progress: {
      ...(input.downloadBytes === undefined
        ? {}
        : {
            download: {
              bytes: input.downloadBytes,
              totalBytes: input.totalBytes,
              bytesPerSecond: input.downloadBps ?? 0,
            },
          }),
      ...(input.uploadBytes === undefined
        ? {}
        : {
            upload: {
              bytes: input.uploadBytes,
              totalBytes: input.totalBytes,
              bytesPerSecond: input.uploadBps ?? 0,
            },
          }),
    },
  }
}

function makeCloudResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (
      id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      'remote-download-storage', 'test-bucket',
      'https://s3.example.com', 'auto', 'test-access-key', 'test-secret-key',
      '$UID/$RAW_NAME', '', 0, 0, 'active', 0, ${100 * 1024 * 1024}, 1, ${now}, ${now}
    )
  `)
}

async function seedCloudBinding(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await seedBusinessLicense(db)
}

async function registerDownloaderThroughDeviceLogin(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  name: string,
  headers?: { Cookie: string },
) {
  const admin = headers ?? (await adminHeaders(app))

  const codeRes = await app.request('/api/auth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'zpan-cli', scope: 'downloader:register' }),
  })
  expect(codeRes.status).toBe(200)
  const code = (await codeRes.json()) as { device_code: string; user_code: string }

  const verifyRes = await app.request(`/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`, {
    headers: admin,
  })
  expect(verifyRes.status).toBe(200)
  await expect(verifyRes.json()).resolves.toMatchObject({ status: 'pending' })

  const approveRes = await app.request('/api/auth/device/approve', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode: code.user_code }),
  })
  expect(approveRes.status).toBe(200)

  const tokenRes = await app.request('/api/auth/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.device_code,
      client_id: 'zpan-cli',
    }),
  })
  expect(tokenRes.status).toBe(200)
  const token = (await tokenRes.json()) as { access_token: string }

  const createDownloaderRes = await app.request('/api/downloads/downloaders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, heartbeat }),
  })
  expect(createDownloaderRes.status).toBe(201)
  return createDownloaderRes.json() as Promise<{ downloader: { id: string; name: string }; token: string }>
}

async function recordDownloaderHeartbeat(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  token: string,
  input: typeof heartbeat = heartbeat,
) {
  const res = await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { assignments: DownloadTask[]; controls: DownloadTask[]; nextPollAfterSeconds: number }
}

async function claimTaskForDownloader(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  token: string,
  taskId: string,
  input: typeof heartbeat = { ...heartbeat, currentTasks: 0 },
) {
  const heartbeatBody = await recordDownloaderHeartbeat(app, token, input)
  const task = heartbeatBody.assignments.find((item) => item.id === taskId)
  expect(task).toBeTruthy()
  return task as DownloadTask
}

describe('Download tasks API integration', () => {
  it('registers a downloader through BetterAuth device login [spec: download-tasks/register-downloader]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const created = await registerDownloaderThroughDeviceLogin(app, 'device-login-downloader')
    expect(created.downloader.name).toBe('device-login-downloader')
    expect(created.token).toBeTruthy()
  })

  it('uses the API key owner UID in the object storage key', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const email = 'api-key-storage-owner@example.com'
    const userHeaders = await authedHeaders(app, email)
    const identities = await db.all<{ userId: string; orgId: string }>(sql`
      SELECT u.id AS userId, o.id AS orgId
      FROM user u
      INNER JOIN member m ON m.user_id = u.id
      INNER JOIN organization o ON o.id = m.organization_id
      WHERE u.email = ${email} AND o.metadata LIKE '%"type":"personal"%'
      LIMIT 1
    `)
    const identity = identities[0]
    expect(identity).toBeTruthy()

    const keyRes = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...userHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configId: 'remote-download',
        name: 'storage-key-owner',
        organizationId: identity.orgId,
      }),
    })
    expect(keyRes.status).toBe(200)
    const apiKey = (await keyRes.json()) as { id: string; key: string }

    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/file.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    expect(task.createdBy).toBe(identity.userId)

    const downloader = await registerDownloaderThroughDeviceLogin(app, 'api-key-storage-downloader', admin)
    const assigned = await claimTaskForDownloader(app, downloader.token, task.id)
    const uploadToken = assigned.status.assignment?.uploadToken
    expect(uploadToken).toBeTruthy()

    const createObjectRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${uploadToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'file.txt',
        type: 'text/plain',
        size: 1,
        parent: '',
      }),
    })
    expect(createObjectRes.status).toBe(201)
    const object = (await createObjectRes.json()) as { id: string }
    const rows = await db.all<{ objectKey: string }>(
      sql`SELECT object AS objectKey FROM matters WHERE id = ${object.id}`,
    )
    expect(rows[0]?.objectKey).toMatch(new RegExp(`^${identity.orgId}/${identity.userId}/\\d{8}/`))
    expect(rows[0]?.objectKey).not.toContain('api-key:')
  })

  it('supports comma-separated task statuses on the status query [spec: download-tasks/list-status-multi]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const user = await authedHeaders(app, 'multi-status-user@example.com')
    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'multi-status-downloader', admin)
    const downloaderHeaders = { Authorization: `Bearer ${createdDownloader.token}` }
    const idleHeartbeat = await recordDownloaderHeartbeat(app, createdDownloader.token, {
      ...heartbeat,
      currentTasks: 0,
    })
    expect(idleHeartbeat.nextPollAfterSeconds).toBe(60)

    const createRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/archive.zip' },
        targetFolder: '',
      }),
    })
    expect(createRes.status).toBe(201)
    const task = (await createRes.json()) as DownloadTask
    expect(task.status.state).toBe('queued')
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    const includedRes = await app.request('/api/downloads/tasks?assignedTo=me&status=assigned,downloading', {
      headers: downloaderHeaders,
    })
    expect(includedRes.status).toBe(200)
    const included = (await includedRes.json()) as DownloadTaskList
    expect(included.items.map((item) => item.id)).toContain(task.id)

    const excludedRes = await app.request('/api/downloads/tasks?assignedTo=me&status=downloading,canceling', {
      headers: downloaderHeaders,
    })
    expect(excludedRes.status).toBe(200)
    const excluded = (await excludedRes.json()) as DownloadTaskList
    expect(excluded.items.map((item) => item.id)).not.toContain(task.id)

    const invalidRes = await app.request('/api/downloads/tasks?assignedTo=me&status=assigned,nope', {
      headers: downloaderHeaders,
    })
    expect(invalidRes.status).toBe(400)
  })

  it('rejects download tasks whose source URL targets an internal host [spec: download-tasks/ssrf-guard]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const user = await authedHeaders(app, 'ssrf-user@example.com')
    for (const uri of [
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8080/admin',
      'http://10.0.0.5/secret',
      'file:///etc/passwd',
    ]) {
      const res = await app.request('/api/downloads/tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { type: 'http', uri }, targetFolder: '' }),
      })
      expect(res.status, `expected ${uri} to be rejected`).toBe(400)
    }
  })

  it('rejects a magnet task whose URI is not a magnet link [spec: download-tasks/magnet-validation]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const user = await authedHeaders(app, 'magnet-user@example.com')
    const res = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'magnet', uri: 'https://example.com/not-a-magnet' }, targetFolder: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('deletes a downloader and returns unfinished tasks to the queue [spec: download-tasks/delete-downloader-requeues]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'delete-me', admin)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'delete-downloader-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/delete-me.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('queued')
    const task = await claimTaskForDownloader(app, createdDownloader.token, createdTask.id)
    expect(task.status.state).toBe('assigned')
    expect(task.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const deleteRes = await app.request(`/api/downloads/downloaders/${createdDownloader.downloader.id}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(deleteRes.status).toBe(204)

    const taskRes = await app.request(`/api/downloads/tasks/${task.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({ status: { state: 'queued', assignment: null } })
    const [requeueEvent] = await db.all<{ fromState: string; toState: string; reason: string }>(sql`
      SELECT
        json_extract(task_event.value, '$.from') AS fromState,
        json_extract(task_event.value, '$.to') AS toState,
        json_extract(task_event.value, '$.reason') AS reason
      FROM download_tasks task
      JOIN json_each(task.events) AS task_event
      WHERE task.id = ${task.id}
        AND json_extract(task_event.value, '$.reason') = 'downloader_deleted'
    `)
    expect(requeueEvent).toEqual({ fromState: 'assigned', toState: 'queued', reason: 'downloader_deleted' })
  })

  it('does not assign new tasks to downloaders with stale heartbeats [spec: download-tasks/stale-no-assign]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    await seedProLicense(db) // 2nd downloader requires downloaders_unlimited
    const admin = await adminHeaders(app)
    const staleDownloader = await registerDownloaderThroughDeviceLogin(app, 'stale-downloader', admin)
    const liveDownloader = await registerDownloaderThroughDeviceLogin(app, 'live-downloader', admin)
    const staleHeaders = {
      Authorization: `Bearer ${staleDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const liveHeaders = {
      Authorization: `Bearer ${liveDownloader.token}`,
      'Content-Type': 'application/json',
    }

    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: staleHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: liveHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const staleHeartbeatAt = Date.now() - 120_000
    await db.run(sql`
      UPDATE downloaders
      SET last_heartbeat_at = ${staleHeartbeatAt}, updated_at = ${staleHeartbeatAt}
      WHERE id = ${staleDownloader.downloader.id}
    `)

    const user = await authedHeaders(app, 'stale-new-task-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/stale-new-task.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status).toMatchObject({ state: 'queued', assignment: null })

    const claimedTask = await claimTaskForDownloader(app, liveDownloader.token, createdTask.id)
    expect(claimedTask).toMatchObject({
      status: { state: 'assigned', assignment: { downloaderId: liveDownloader.downloader.id } },
    })
  })

  it('keeps tasks queued when matching downloaders are at capacity [spec: download-tasks/capacity-queue]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'busy-downloader', admin)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: heartbeat.maxConcurrentTasks }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'busy-downloader-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/busy-capacity.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status).toMatchObject({ state: 'queued', assignment: null })

    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: heartbeat.maxConcurrentTasks - 1 }),
      }),
    ).toHaveProperty('status', 200)

    const taskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({
      status: { state: 'assigned', assignment: { downloaderId: createdDownloader.downloader.id } },
    })
  })

  it('reports stale downloaders as offline in the admin list [spec: download-tasks/stale-offline]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const staleDownloader = await registerDownloaderThroughDeviceLogin(app, 'admin-stale-downloader', admin)
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${staleDownloader.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const staleHeartbeatAt = Date.now() - 120_000
    await db.run(sql`
      UPDATE downloaders
      SET last_heartbeat_at = ${staleHeartbeatAt}, updated_at = ${staleHeartbeatAt}
      WHERE id = ${staleDownloader.downloader.id}
    `)

    const listRes = await app.request('/api/downloads/downloaders', { headers: admin })
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { items: Downloader[] }
    const listed = body.items.find((item) => item.id === staleDownloader.downloader.id)
    expect(listed?.status).toBe('offline')
  })

  it('settles a stale downloader’s canceling task to canceled [spec: download-tasks/stale-resolves-canceling]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const downloader = await registerDownloaderThroughDeviceLogin(app, 'stale-cancel-downloader', admin)
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'stale-cancel-user@example.com')
    const createRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'http', uri: 'https://example.com/stale-cancel.bin' }, targetFolder: '' }),
    })
    expect(createRes.status).toBe(201)
    const createdTask = (await createRes.json()) as DownloadTask
    const task = await claimTaskForDownloader(app, downloader.token, createdTask.id)
    expect(task.status.assignment?.downloaderId).toBe(downloader.downloader.id)

    // Cancel while assigned → canceling, waiting for the downloader to ack.
    const cancelRes = await app.request(`/api/downloads/tasks/${task.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: { state: 'canceling' } })

    // The downloader went offline before acking — and a prior sweep already
    // flipped its status to 'offline' (the case that left tasks stuck forever).
    const staleHeartbeatAt = Date.now() - 120_000
    await db.run(sql`
      UPDATE downloaders
      SET last_heartbeat_at = ${staleHeartbeatAt}, status = 'offline', updated_at = ${staleHeartbeatAt}
      WHERE id = ${downloader.downloader.id}
    `)

    // Stale recovery (triggered here by the admin list) must settle it, not leave it stuck.
    expect((await app.request('/api/downloads/downloaders', { headers: admin })).status).toBe(200)

    const taskRes = await app.request(`/api/downloads/tasks/${task.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({ status: { state: 'canceled', assignment: null } })
  })

  it('clears stale seeding only on tasks not owned by a live downloader [spec: download-tasks/stale-clears-seeding]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const downloader = await registerDownloaderThroughDeviceLogin(app, 'live-seed-downloader', admin)
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'stale-seed-user@example.com')
    const create = async (uri: string) => {
      const res = await app.request('/api/downloads/tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { type: 'http', uri }, targetFolder: '' }),
      })
      expect(res.status).toBe(201)
      return (await res.json()) as DownloadTask
    }
    const seedingRuntime = JSON.stringify({
      engine: 'aria2',
      phase: 'seeding',
      seeding: { active: true },
      progress: {
        download: { bytes: 2048, totalBytes: 2048, bytesPerSecond: 0 },
        upload: { bytes: 2048, totalBytes: 2048, bytesPerSecond: 0 },
      },
    })

    // Live task: completed + seeding, still owned by the live downloader → kept.
    const liveTask = await create('https://example.com/live-seed.bin')
    const orphanTask = await create('https://example.com/orphan-seed.bin')
    await recordDownloaderHeartbeat(app, downloader.token, { ...heartbeat, currentTasks: 0 })

    await db.run(
      sql`UPDATE download_tasks SET status = 'completed', runtime = ${seedingRuntime} WHERE id = ${liveTask.id}`,
    )
    // Orphan task: completed + seeding, owned by a downloader that was deleted → cleared.
    await db.run(sql`
      UPDATE download_tasks
      SET status = 'completed', runtime = ${seedingRuntime}, assigned_downloader_id = 'deleted-downloader-id'
      WHERE id = ${orphanTask.id}
    `)

    const runtimeOf = async (id: string) =>
      ((await (await app.request(`/api/downloads/tasks/${id}`, { headers: user })).json()) as DownloadTask).status
        .runtime
    const phaseOf = async (id: string) => (await runtimeOf(id))?.phase ?? null
    expect(await phaseOf(liveTask.id)).toBe('seeding')
    expect(await phaseOf(orphanTask.id)).toBe('seeding')

    // Trigger stale recovery via the admin downloaders list.
    expect((await app.request('/api/downloads/downloaders', { headers: admin })).status).toBe(200)

    expect(await phaseOf(liveTask.id)).toBe('seeding') // live downloader's seed is preserved
    const orphanRuntime = await runtimeOf(orphanTask.id)
    expect(orphanRuntime?.phase).not.toBe('seeding') // deleted owner's stale seed is cleared
    expect(orphanRuntime?.seeding ?? null).toBeNull() // the stale seeding object is dropped
    // ...but the download/upload transfer record is preserved, not wiped.
    expect(orphanRuntime?.progress?.download).toMatchObject({ bytes: 2048, totalBytes: 2048 })
  })

  it('reassigns unfinished tasks from stale downloaders on live heartbeat [spec: download-tasks/reassign-on-heartbeat]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    await seedProLicense(db) // 2nd downloader requires downloaders_unlimited
    const admin = await adminHeaders(app)
    const staleDownloader = await registerDownloaderThroughDeviceLogin(app, 'reassign-stale-downloader', admin)
    const staleHeaders = {
      Authorization: `Bearer ${staleDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: staleHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'stale-reassign-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/stale-reassign.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const queuedTask = (await createTaskRes.json()) as DownloadTask
    const createdTask = await claimTaskForDownloader(app, staleDownloader.token, queuedTask.id)
    expect(createdTask.status.assignment?.downloaderId).toBe(staleDownloader.downloader.id)

    const staleHeartbeatAt = Date.now() - 120_000
    await db.run(sql`
      UPDATE downloaders
      SET last_heartbeat_at = ${staleHeartbeatAt}, updated_at = ${staleHeartbeatAt}
      WHERE id = ${staleDownloader.downloader.id}
    `)

    const liveDownloader = await registerDownloaderThroughDeviceLogin(app, 'reassign-live-downloader', admin)
    const liveHeartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${liveDownloader.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(liveHeartbeatRes.status).toBe(200)

    const taskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({
      status: { state: 'assigned', assignment: { downloaderId: liveDownloader.downloader.id } },
    })
  })

  it('runs the remote download task upload flow through the standard object upload API [spec: download-tasks/upload-flow]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'vps-1')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }

    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0, downloadBps: 128_000 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'downloader-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/fixture.txt' },
        targetFolder: 'Remote Downloads',
        name: 'fixture.txt',
        category: 'fixtures',
        tags: ['sample', 'http'],
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('queued')
    const claimedTask = await claimTaskForDownloader(app, createdDownloader.token, createdTask.id)
    expect(claimedTask.status.state).toBe('assigned')
    expect(claimedTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)
    expect(createdTask.spec.labels.category).toBe('fixtures')
    expect(createdTask.spec.labels.tags).toEqual(['sample', 'http'])
    expect(createdTask.status.assignment?.uploadToken).toBeUndefined()

    const assignedRes = await app.request('/api/downloads/tasks?assignedTo=me&category=fixtures&tag=http', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(assignedRes.status).toBe(200)
    const assigned = (await assignedRes.json()) as DownloadTaskList
    const assignedTask = assigned.items.find((item) => item.id === createdTask.id)
    expect(assignedTask?.status.state).toBe('assigned')
    expect(assignedTask?.spec.labels.category).toBe('fixtures')
    expect(assignedTask?.spec.labels.tags).toEqual(['sample', 'http'])
    expect(assignedTask?.status.assignment?.uploadToken).toBeTruthy()
    const uploadHeaders = {
      Authorization: `Bearer ${assignedTask?.status.assignment?.uploadToken}`,
      'Content-Type': 'application/json',
    }

    const downloadingRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'downloading',
        ...transferProgress({
          downloadBytes: 10 * 1024 * 1024,
          totalBytes: 10 * 1024 * 1024,
          downloadBps: 512_000,
        }),
        runtime: {
          engine: 'aria2',
          phase: 'downloading',
          state: 'active',
          etaSeconds: 42,
          connections: 8,
          torrent: { infoHash: 'abc123', name: 'fixture', seeders: 3 },
          trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 3, peers: 8 }],
          peers: [{ address: '127.0.0.1:6881', client: 'libtorrent', progress: 0.5, downloadBps: 128_000 }],
          files: [{ path: 'fixture.txt', size: 10 * 1024 * 1024, completedBytes: 5 * 1024 * 1024 }],
        },
      }),
    })
    expect(downloadingRes.status).toBe(200)
    const downloadingTask = (await downloadingRes.json()) as DownloadTask
    const runtime = downloadingTask.status.runtime
    expect(runtime).toBeTruthy()
    expect(runtime?.torrent).toBeTruthy()
    expect(runtime?.trackers).toBeTruthy()
    expect(runtime?.engine).toBe('aria2')
    expect(runtime?.etaSeconds).toBe(42)
    expect(runtime?.torrent?.infoHash).toBe('abc123')
    expect(runtime?.trackers?.[0]?.url).toBe('udp://tracker.example/announce')

    const recoverDownloadingRes = await app.request('/api/downloads/tasks?assignedTo=me&status=downloading', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(recoverDownloadingRes.status).toBe(200)
    const recoverDownloading = (await recoverDownloadingRes.json()) as DownloadTaskList
    const recoverDownloadingTask = recoverDownloading.items.find((item) => item.id === createdTask.id)
    expect(recoverDownloadingTask?.status.state).toBe('downloading')
    expect(recoverDownloadingTask?.status.assignment?.uploadToken).toBeTruthy()
    expect(recoverDownloadingTask?.status.assignment?.uploadToken).toBe(assignedTask?.status.assignment?.uploadToken)

    // Simulate an out-of-band deletion between task creation and ingestion. The
    // task upload preflight must recreate the target instead of producing an
    // orphan path.
    await db.run(sql`
      UPDATE matters
      SET trashed_at = ${Date.now()}
      WHERE org_id = ${createdTask.orgId} AND parent = '' AND name = 'Remote Downloads'
    `)

    const createFolderRes = await app.request('/api/objects', {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        name: 'fixture-dir',
        type: 'folder',
        dirtype: 1,
        parent: 'Remote Downloads',
      }),
    })
    expect(createFolderRes.status).toBe(201)
    const folder = (await createFolderRes.json()) as { id: string; name: string; status: string; dirtype: number }
    expect(folder.status).toBe('active')
    expect(folder.name).toBe('fixture-dir')
    expect(folder.dirtype).toBe(1)
    const liveTargets = await db.all<{ count: number }>(sql`
      SELECT count(*) AS count
      FROM matters
      WHERE org_id = ${createdTask.orgId}
        AND parent = ''
        AND name = 'Remote Downloads'
        AND status = 'active'
        AND trashed_at IS NULL
    `)
    expect(liveTargets[0].count).toBe(1)

    // Multi-file downloads write below the configured target. Recreate a child
    // directory too if it disappears between two uploaded files.
    await db.run(sql`
      UPDATE matters
      SET trashed_at = ${Date.now()}
      WHERE id = ${folder.id}
    `)

    const createNestedObjectRes = await app.request('/api/objects', {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        name: 'nested.txt',
        type: 'text/plain',
        size: 0,
        parent: 'Remote Downloads/fixture-dir',
      }),
    })
    expect(createNestedObjectRes.status).toBe(201)
    const nestedObject = (await createNestedObjectRes.json()) as {
      id: string
      status: string
      upload: { sessionId: string; urls: string[] }
    }
    expect(nestedObject.status).toBe('draft')
    expect(nestedObject.upload.urls).toEqual(['https://presigned-upload.example.com'])
    const liveNestedParents = await db.all<{ count: number }>(sql`
      SELECT count(*) AS count
      FROM matters
      WHERE org_id = ${createdTask.orgId}
        AND parent = 'Remote Downloads'
        AND name = 'fixture-dir'
        AND status = 'active'
        AND trashed_at IS NULL
    `)
    expect(liveNestedParents[0].count).toBe(1)

    // Finalize the nested upload via the completions endpoint (single-PUT path).
    const nestedConfirmRes = await app.request(
      `/api/objects/${nestedObject.id}/uploads/${nestedObject.upload.sessionId}/completions`,
      {
        method: 'POST',
        headers: uploadHeaders,
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'etag-1' }] }),
      },
    )
    expect(nestedConfirmRes.status).toBe(200)

    const outsideFolderRes = await app.request('/api/objects', {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        name: 'outside',
        type: 'folder',
        dirtype: 1,
        parent: 'Other Folder',
      }),
    })
    expect(outsideFolderRes.status).toBe(403)

    const createObjectRes = await app.request('/api/objects', {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        name: 'fixture.txt',
        type: 'text/plain',
        size: 10 * 1024 * 1024,
        parent: 'Remote Downloads',
      }),
    })
    expect(createObjectRes.status).toBe(201)
    const object = (await createObjectRes.json()) as {
      id: string
      status: string
      upload: { sessionId: string; partSize: number; urls: string[] }
    }
    expect(object.status).toBe('draft')
    // 10 MiB ≤ 5 GiB → single PutObject: one presigned URL.
    expect(object.upload.urls).toEqual(['https://presigned-upload.example.com'])

    // Re-presign is multipart-only; this single-PUT session has no parts to re-presign.
    const partsRes = await app.request(`/api/objects/${object.id}/uploads/${object.upload.sessionId}/parts`, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({ partNumbers: [1] }),
    })
    expect(partsRes.status).toBe(409)

    const confirmRes = await app.request(`/api/objects/${object.id}/uploads/${object.upload.sessionId}/completions`, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    })
    expect(confirmRes.status).toBe(200)
    const confirmed = (await confirmRes.json()) as { id: string; status: string }
    expect(confirmed.status).toBe('active')

    const uploadingRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'uploading',
        ...transferProgress({ downloadBytes: 10 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 }),
      }),
    })
    expect(uploadingRes.status).toBe(200)
    const recoverUploadingRes = await app.request('/api/downloads/tasks?assignedTo=me&status=uploading', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(recoverUploadingRes.status).toBe(200)
    const recoverUploading = (await recoverUploadingRes.json()) as DownloadTaskList
    const recoverUploadingTask = recoverUploading.items.find((item) => item.id === createdTask.id)
    expect(recoverUploadingTask?.status.state).toBe('uploading')
    expect(recoverUploadingTask?.status.assignment?.uploadToken).toBeTruthy()

    const completeTaskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        ...transferProgress({
          downloadBytes: 10 * 1024 * 1024,
          uploadBytes: 10 * 1024 * 1024,
          totalBytes: 10 * 1024 * 1024,
        }),
        resultObjectId: object.id,
      }),
    })
    expect(completeTaskRes.status).toBe(200)

    const taskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    const task = (await taskRes.json()) as DownloadTask
    expect(task.status.state).toBe('completed')
    expect(task.status.output?.objectId).toBe(object.id)
    expect(task.status.progress.download.bytes).toBe(10 * 1024 * 1024)
    expect(task.status.progress.upload.bytes).toBe(10 * 1024 * 1024)
  })

  it('accepts Cloud usage event ids that differ from local remote download idempotency keys [spec: download-tasks/cloud-usage-idempotency]', async () => {
    const { app, db } = await createTestApp({
      DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret',
      ZPAN_CLOUD_URL: 'https://cloud.example',
    })
    await insertStorage(db)
    await seedCloudBinding(db)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          makeCloudResponse({ data: { accepted: true, duplicate: false, eventId: 'different-event-id' } }),
        ),
    )

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'billing-transient-downloader')
    await db.run(sql`
      UPDATE downloaders
      SET remote_download_credit_billing_enabled = 1,
          remote_download_credit_unit_bytes = ${5 * 1024 * 1024},
          remote_download_credit_per_unit = 1
      WHERE id = ${createdDownloader.downloader.id}
    `)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-billing-transient-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/billing-transient.bin' },
        targetFolder: 'Remote Downloads',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    const patchRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'downloading',
        ...transferProgress({
          downloadBytes: 5 * 1024 * 1024,
          totalBytes: 10 * 1024 * 1024,
          downloadBps: 512_000,
        }),
      }),
    })

    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      status: {
        state: 'downloading',
        // 5MB downloaded of a 10MB (2-unit) file pre-authorizes the current unit
        // plus the next — units 1 and 2 — so the whole file is paid up front.
        billing: { state: 'ok', chargedBytes: 10 * 1024 * 1024, chargedCredits: 2 },
      },
    })
    await expect(db.select().from(remoteDownloadUsageReports)).resolves.toMatchObject([
      { eventId: `remote_download:${task.id}:1`, status: 'reported', error: null },
      { eventId: `remote_download:${task.id}:2`, status: 'reported', error: null },
    ])
  })

  it('suspends with a reason at the downloading gate when credits are exhausted [spec: download-tasks/billing-suspend-gate]', async () => {
    const { app, db } = await createTestApp({
      DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret',
      ZPAN_CLOUD_URL: 'https://cloud.example',
    })
    await insertStorage(db)
    await seedCloudBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeCloudResponse({ error: { code: 'insufficient_credits' } }, 402)),
    )

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'billing-suspend-downloader')
    await db.run(sql`
      UPDATE downloaders
      SET remote_download_credit_billing_enabled = 1,
          remote_download_credit_unit_bytes = ${5 * 1024 * 1024},
          remote_download_credit_per_unit = 1
      WHERE id = ${createdDownloader.downloader.id}
    `)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'billing-suspend-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'http', uri: 'https://example.com/no-credit.bin' }, targetFolder: '' }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    // The downloader marks the task downloading (the credit gate) before pulling any bytes.
    const patchRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as DownloadTask
    expect(patched.status.state).toBe('suspended')
    expect(patched.status.runtime?.message ?? '').toContain('credit')
    expect(patched.status.progress.download.bytes).toBe(0)

    const stoppingHeartbeat = await recordDownloaderHeartbeat(app, createdDownloader.token, {
      ...heartbeat,
      currentTasks: 1,
    })
    expect(stoppingHeartbeat.controls.some((item) => item.id === task.id)).toBe(true)
    expect(stoppingHeartbeat.nextPollAfterSeconds).toBe(5)

    const stoppedHeartbeat = await recordDownloaderHeartbeat(app, createdDownloader.token, {
      ...heartbeat,
      currentTasks: 0,
    })
    expect(stoppedHeartbeat.controls.some((item) => item.id === task.id)).toBe(true)
    expect(stoppedHeartbeat.nextPollAfterSeconds).toBe(60)
  })

  it('recovers a suspended task when credits are restored [spec: download-tasks/billing-recover]', async () => {
    const { app, db } = await createTestApp({
      DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret',
      ZPAN_CLOUD_URL: 'https://cloud.example',
    })
    await insertStorage(db)
    await seedCloudBinding(db)
    // First charge attempt is blocked; after a top-up the retry is accepted.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(makeCloudResponse({ error: { code: 'insufficient_credits' } }, 402))
        .mockResolvedValue(makeCloudResponse({ data: { accepted: true, duplicate: false, eventId: 'evt' } })),
    )

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'billing-recover-downloader')
    await db.run(sql`
      UPDATE downloaders
      SET remote_download_credit_billing_enabled = 1,
          remote_download_credit_unit_bytes = ${5 * 1024 * 1024},
          remote_download_credit_per_unit = 1
      WHERE id = ${createdDownloader.downloader.id}
    `)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloads/downloaders/me/heartbeats', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'billing-recover-user@example.com')
    const createRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { type: 'http', uri: 'https://example.com/recover.bin' }, targetFolder: '' }),
    })
    expect(createRes.status).toBe(201)
    const task = (await createRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    // Credits exhausted → suspended at the gate (unit 1 recorded blocked).
    const blockedRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(((await blockedRes.json()) as DownloadTask).status.state).toBe('suspended')

    // Credits restored → retrying the same unit re-asks the cloud and succeeds.
    const recoverRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    const recovered = (await recoverRes.json()) as DownloadTask
    expect(recovered.status.state).toBe('downloading')
    expect(recovered.status.billing?.state).toBe('ok')
    expect(recovered.status.billing?.chargedCredits).toBe(1)
  })

  it('stores downloader runtime reports as snapshots while progress remains patchable [spec: download-tasks/runtime-reports]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'patch-progress-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'patch-progress-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:patchprogress' },
        targetFolder: 'Remote Downloads',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    const totalBytes = 10 * 1024 * 1024
    const downloadingRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'downloading',
        ...transferProgress({ downloadBytes: totalBytes, totalBytes, downloadBps: 512_000 }),
        runtime: {
          engine: 'aria2',
          phase: 'downloading',
          progress: {
            download: { bytes: totalBytes, totalBytes, bytesPerSecond: 512_000 },
            upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
          },
          torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
          trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 2 }],
        },
      }),
    })
    expect(downloadingRes.status).toBe(200)

    const uploadingRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'uploading',
        ...transferProgress({ uploadBytes: 4 * 1024 * 1024, totalBytes, uploadBps: 256_000 }),
        runtime: {
          engine: 'aria2',
          phase: 'uploading',
          etaSeconds: 24,
          progress: {
            download: { bytes: totalBytes, totalBytes, bytesPerSecond: 0 },
            upload: { bytes: 4 * 1024 * 1024, totalBytes, bytesPerSecond: 256_000 },
          },
          torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
          trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 2 }],
        },
      }),
    })
    expect(uploadingRes.status).toBe(200)
    const uploadingTask = (await uploadingRes.json()) as DownloadTask

    expect(uploadingTask.status.progress.download).toMatchObject({
      bytes: totalBytes,
      totalBytes,
      bytesPerSecond: 0,
    })
    expect(uploadingTask.status.progress.upload).toMatchObject({
      bytes: 4 * 1024 * 1024,
      totalBytes,
      bytesPerSecond: 256_000,
    })
    expect(uploadingTask.status.runtime).toMatchObject({
      engine: 'aria2',
      phase: 'uploading',
      etaSeconds: 24,
      progress: {
        download: { bytes: totalBytes, totalBytes, bytesPerSecond: 0 },
        upload: { bytes: 4 * 1024 * 1024, totalBytes, bytesPerSecond: 256_000 },
      },
      torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
      trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 2 }],
    })

    const replacementRuntimeRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        runtime: { phase: 'uploading' },
      }),
    })
    expect(replacementRuntimeRes.status).toBe(200)
    const replacementRuntimeTask = (await replacementRuntimeRes.json()) as DownloadTask
    // A phase-only report (e.g. a seeding-stopped report) replaces the snapshot
    // fields but preserves the cumulative download/upload progress.
    expect(replacementRuntimeTask.status.runtime).toEqual({
      phase: 'uploading',
      progress: {
        download: { bytes: totalBytes, totalBytes, bytesPerSecond: 0 },
        upload: { bytes: 4 * 1024 * 1024, totalBytes, bytesPerSecond: 256_000 },
      },
    })

    const completedRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        runtime: {
          engine: 'aria2',
          phase: 'completed',
          torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
        },
      }),
    })
    expect(completedRes.status).toBe(200)
    const completedTask = (await completedRes.json()) as DownloadTask
    expect(completedTask.status.runtime).toMatchObject({
      engine: 'aria2',
      phase: 'completed',
      torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
    })
    expect(completedTask.status.runtime).not.toHaveProperty('etaSeconds')
    // The completed snapshot omitted progress, but the transfer record survives.
    expect(completedTask.status.runtime?.progress).toMatchObject({
      download: { bytes: totalBytes, totalBytes },
      upload: { bytes: 4 * 1024 * 1024, totalBytes },
    })

    const seedingRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        runtime: {
          engine: 'aria2',
          phase: 'seeding',
          torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
          seeding: { active: true, uploadedBytes: 1024, uploadBytesPerSecond: 128 },
        },
      }),
    })
    expect(seedingRes.status).toBe(200)
    const seedingTask = (await seedingRes.json()) as DownloadTask
    expect(seedingTask.status.runtime).toMatchObject({
      engine: 'aria2',
      phase: 'seeding',
      torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
      seeding: { active: true, uploadedBytes: 1024, uploadBytesPerSecond: 128 },
    })
    expect(seedingTask.status.runtime).not.toHaveProperty('etaSeconds')
  })

  it('returns a task timeline from lifecycle fields and activity events [spec: download-tasks/events]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'timeline-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    await recordDownloaderHeartbeat(app, createdDownloader.token, { ...heartbeat, currentTasks: 0 })

    const user = await authedHeaders(app, 'timeline-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:timeline' },
        targetFolder: 'Remote Downloads',
        name: 'timeline.torrent',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    const resolvingRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'downloading',
        runtime: {
          engine: 'aria2',
          phase: 'metadata',
          torrent: { infoHash: 'timeline-info-hash', peers: 0, seeders: 0 },
          trackers: [{ url: 'udp://tracker.example/announce', status: 'announce' }],
        },
      }),
    })
    expect(resolvingRes.status).toBe(200)
    const resolvingTask = (await resolvingRes.json()) as DownloadTask
    expect(resolvingTask.status.resolveStartedAt).toBeTruthy()

    const totalBytes = 1024 * 1024
    const ingestingRes = await app.request(`/api/downloads/tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'uploading',
        ...transferProgress({ downloadBytes: totalBytes, uploadBytes: 512, totalBytes }),
        runtime: {
          engine: 'aria2',
          phase: 'uploading',
          progress: {
            download: { bytes: totalBytes, totalBytes, bytesPerSecond: 0 },
            upload: { bytes: 512, totalBytes, bytesPerSecond: 128 },
          },
          torrent: { infoHash: 'timeline-info-hash', peers: 2, seeders: 1 },
        },
      }),
    })
    expect(ingestingRes.status).toBe(200)
    const ingestingTask = (await ingestingRes.json()) as DownloadTask
    expect(ingestingTask.status.resolveCompletedAt).toBeTruthy()
    expect(ingestingTask.status.downloadCompletedAt).toBeTruthy()
    expect(ingestingTask.status.ingestStartedAt).toBeTruthy()

    const eventsRes = await app.request(`/api/downloads/tasks/${task.id}/events`, { headers: user })
    expect(eventsRes.status).toBe(200)
    const body = (await eventsRes.json()) as { items: DownloadTaskTimelineItem[] }
    const actions = body.items.map((item) => item.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        'download_task_created',
        'download_task_assigned',
        'download_resolve_started',
        'download_resolve_completed',
        'download_completed',
        'download_ingest_started',
      ]),
    )
    expect(body.items[0]?.time).toBeTruthy()
    expect(body.items.find((item) => item.action === 'download_resolve_started')?.metadata).toBeNull()
    const actors = await db.all<{ action: string; actorType: string; actorRef: string | null }>(sql`
      SELECT action, actor_type AS actorType, actor_ref AS actorRef
      FROM audit_events
      WHERE target_type = 'download_task' AND target_id = ${task.id}
    `)
    expect(actors.find((event) => event.action === 'download_task_created')).toMatchObject({ actorType: 'user' })
    expect(actors.find((event) => event.action === 'download_task_assigned')).toBeUndefined()
    expect(actors.find((event) => event.action === 'download_resolve_started')).toBeUndefined()
  })

  it('returns storage failure details when multipart upload session creation fails [spec: download-tasks/upload-session-failure]', async () => {
    vi.mocked(S3Service.prototype.createMultipartUpload).mockRejectedValueOnce(
      new Error('bucket does not support multipart'),
    )
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'multipart-failure-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)
    const user = await authedHeaders(app, 'multipart-failure-user@example.com')

    const taskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:multipartfail' },
        targetFolder: 'Remote Downloads',
      }),
    })
    expect(taskRes.status).toBe(201)
    const task = (await taskRes.json()) as DownloadTask
    await claimTaskForDownloader(app, createdDownloader.token, task.id)

    const tasksRes = await app.request('/api/downloads/tasks?assignedTo=me&status=assigned', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    const tasks = (await tasksRes.json()) as DownloadTaskList
    const uploadHeaders = {
      Authorization: `Bearer ${tasks.items[0].status.assignment?.uploadToken}`,
      'Content-Type': 'application/json',
    }
    // A >5 GiB file is multipart; createObject opens the S3 multipart upload up
    // front, so the failure surfaces on POST /api/objects itself.
    const createObjectRes = await app.request('/api/objects', {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({
        name: 'fixture.bin',
        type: 'application/octet-stream',
        size: 6 * 1024 * 1024 * 1024,
        parent: 'Remote Downloads',
      }),
    })

    expect(createObjectRes.status).toBe(502)
    const sessionBody = (await createObjectRes.json()) as { error: { message: string; details: { reason: string }[] } }
    expect(sessionBody.error.message).toBe('Storage multipart upload failed: bucket does not support multipart')
    expect(sessionBody.error.details[0].reason).toBe('STORAGE_FAILURE')
  })

  it('normalizes target folder paths when creating download tasks [spec: download-tasks/normalize-target]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    await registerDownloaderThroughDeviceLogin(app, 'target-folder-downloader')
    const user = await authedHeaders(app, 'target-folder-user@example.com')

    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/fixture.txt' },
        targetFolder: '/media//Movies/',
      }),
    })

    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    expect(task).toMatchObject({
      spec: { destination: { folder: 'media/Movies' } },
    })

    const rows = await db.all<{ target_folder: string }>(
      sql`SELECT target_folder FROM download_tasks ORDER BY created_at DESC LIMIT 1`,
    )
    expect(rows[0].target_folder).toBe('media/Movies')

    const folders = await db.all<{ name: string; parent: string; status: string }>(sql`
      SELECT name, parent, status
      FROM matters
      WHERE org_id = ${task.orgId} AND dirtype = 1
      ORDER BY parent, name
    `)
    expect(folders).toEqual([
      { name: 'media', parent: '', status: 'active' },
      { name: 'Movies', parent: 'media', status: 'active' },
    ])
  })

  it('rejects a target folder path that contains a file', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const email = 'target-folder-file-user@example.com'
    const user = await authedHeaders(app, email)
    const orgRows = await db.all<{ orgId: string }>(sql`
      SELECT m.organization_id AS orgId
      FROM member m
      JOIN user u ON u.id = m.user_id
      WHERE u.email = ${email}
      LIMIT 1
    `)
    const now = Math.floor(Date.now() / 1000)
    await db.run(sql`
      INSERT INTO matters (
        id, org_id, alias, name, type, size, dirtype, parent, object,
        storage_id, status, created_at, updated_at
      ) VALUES (
        'target-file', ${orgRows[0].orgId}, 'target-file-alias', 'media',
        'text/plain', 1, 0, '', 'target-file-key', 'remote-download-storage',
        'active', ${now}, ${now}
      )
    `)

    const res = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/fixture.txt' },
        targetFolder: 'media/Movies',
      }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('TARGET_FOLDER_NOT_DIRECTORY')
    const tasks = await db.all<{ count: number }>(sql`SELECT count(*) AS count FROM download_tasks`)
    expect(tasks[0].count).toBe(0)
  })

  it('blocks changes to an active task target folder and its ancestors', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const user = await authedHeaders(app, 'occupied-target-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/fixture.txt' },
        targetFolder: 'Media/Movies',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask
    // Tasks created before canonical target persistence can differ only in case
    // from the live matter path. They must still hold the directory lease.
    await db.run(sql`UPDATE download_tasks SET target_folder = 'media/movies' WHERE id = ${task.id}`)
    const folders = await db.all<{ id: string; name: string }>(sql`
      SELECT id, name FROM matters WHERE org_id = ${task.orgId} AND dirtype = 1
    `)
    const media = folders.find((folder) => folder.name === 'Media')
    const movies = folders.find((folder) => folder.name === 'Movies')
    expect(media).toBeTruthy()
    expect(movies).toBeTruthy()

    const deleteAncestor = await app.request(`/api/objects/${media?.id}`, { method: 'DELETE', headers: user })
    expect(deleteAncestor.status).toBe(409)
    const deleteBody = (await deleteAncestor.json()) as {
      error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(deleteBody.error.details[0]).toMatchObject({
      reason: 'DIRECTORY_IN_USE',
      metadata: { taskId: task.id, targetFolder: 'media/movies' },
    })

    const renameTarget = await app.request(`/api/objects/${movies?.id}`, {
      method: 'PATCH',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Films' }),
    })
    expect(renameTarget.status).toBe(409)

    await db.run(sql`UPDATE download_tasks SET status = 'completed' WHERE id = ${task.id}`)
    const deleteAfterCompletion = await app.request(`/api/objects/${media?.id}`, { method: 'DELETE', headers: user })
    expect(deleteAfterCompletion.status).toBe(204)
  })

  it('recreates a missing target when retrying or restarting a task', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const user = await authedHeaders(app, 'reactivate-target-user@example.com')
    const createRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/reactivate.bin' },
        targetFolder: 'Archive/Movies',
      }),
    })
    const task = (await createRes.json()) as DownloadTask

    const removeTarget = () =>
      db.run(sql`
        UPDATE matters
        SET trashed_at = ${Date.now()}
        WHERE org_id = ${task.orgId} AND parent = 'Archive' AND name = 'Movies' AND trashed_at IS NULL
      `)
    await removeTarget()
    await db.run(sql`UPDATE download_tasks SET status = 'failed' WHERE id = ${task.id}`)

    const retryRes = await app.request(`/api/downloads/tasks/${task.id}/attempts`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fresh: false }),
    })
    expect(retryRes.status).toBe(201)
    await expect(retryRes.json()).resolves.toMatchObject({ status: { state: 'queued' } })

    await removeTarget()
    const restartRes = await app.request(`/api/downloads/tasks/${task.id}/attempts`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fresh: true }),
    })
    expect(restartRes.status).toBe(201)
    await expect(restartRes.json()).resolves.toMatchObject({
      spec: { destination: { folder: 'Archive/Movies' } },
      status: { state: 'queued', attempt: 2 },
    })

    const liveTargets = await db.all<{ count: number }>(sql`
      SELECT count(*) AS count
      FROM matters
      WHERE org_id = ${task.orgId}
        AND parent = 'Archive'
        AND name = 'Movies'
        AND status = 'active'
        AND trashed_at IS NULL
    `)
    expect(liveTargets[0].count).toBe(1)
  })

  it('returns storage failure details when multipart upload completion fails [spec: download-tasks/upload-completion-failure]', async () => {
    vi.mocked(S3Service.prototype.completeMultipartUpload).mockRejectedValueOnce(new Error('InvalidPart: part missing'))
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const headers = {
      ...(await authedHeaders(app, 'multipart-complete-user@example.com')),
      'Content-Type': 'application/json',
    }

    const createObjectRes = await app.request('/api/objects', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'fixture.bin',
        type: 'application/octet-stream',
        size: 6 * 1024 * 1024 * 1024,
        parent: '',
      }),
    })
    expect(createObjectRes.status).toBe(201)
    const object = (await createObjectRes.json()) as { id: string; upload: { sessionId: string } }

    // Multipart completion calls CompleteMultipartUpload, which is mocked to reject.
    const completeRes = await app.request(`/api/objects/${object.id}/uploads/${object.upload.sessionId}/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: '"etag-1"' }] }),
    })

    expect(completeRes.status).toBe(502)
    const completeBody = (await completeRes.json()) as { error: { message: string; details: { reason: string }[] } }
    expect(completeBody.error.message).toBe('Storage multipart upload complete failed: InvalidPart: part missing')
    expect(completeBody.error.details[0].reason).toBe('STORAGE_FAILURE')
  })

  it('submits user task actions through downloader polling state [spec: download-tasks/user-actions]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'action-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-actions-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/actions.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const queuedTask = (await createTaskRes.json()) as DownloadTask
    const createdTask = await claimTaskForDownloader(app, createdDownloader.token, queuedTask.id)
    expect(createdTask.status.state).toBe('assigned')
    expect(createdTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const pauseRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'paused' } })

    const pausedAssignedRes = await app.request('/api/downloads/tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(pausedAssignedRes.status).toBe(200)
    const pausedAssigned = (await pausedAssignedRes.json()) as DownloadTaskList
    expect(pausedAssigned.items.find((item) => item.id === createdTask.id)?.status.state).toBe('paused')

    const pausedProgressRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify(transferProgress({ downloadBytes: 1024, downloadBps: 512 })),
    })
    expect(pausedProgressRes.status).toBe(409)
    const pausedProgressBody = (await pausedProgressRes.json()) as {
      error: { message: string; details: { reason: string }[] }
    }
    expect(pausedProgressBody.error.message).toBe('Task is paused')
    expect(pausedProgressBody.error.details[0].reason).toBe('INVALID_STATE')

    const resumeRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({ status: { state: 'queued' } })
    await claimTaskForDownloader(app, createdDownloader.token, createdTask.id)

    const cancelRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: { state: 'canceling' } })

    const canceledAssignedRes = await app.request('/api/downloads/tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(canceledAssignedRes.status).toBe(200)
    const canceledAssigned = (await canceledAssignedRes.json()) as DownloadTaskList
    expect(canceledAssigned.items.find((item) => item.id === createdTask.id)?.status.state).toBe('canceling')

    const canceledAckRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledAckRes.status).toBe(200)
    await expect(canceledAckRes.json()).resolves.toMatchObject({ status: { state: 'canceled' } })

    const canceledCompleteRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        ...transferProgress({ downloadBytes: 2048, uploadBytes: 2048, totalBytes: 2048 }),
      }),
    })
    expect(canceledCompleteRes.status).toBe(409)
    const canceledCompleteBody = (await canceledCompleteRes.json()) as {
      error: { message: string; details: { reason: string }[] }
    }
    expect(canceledCompleteBody.error.message).toBe('Task is canceled')
    expect(canceledCompleteBody.error.details[0].reason).toBe('INVALID_STATE')

    const deleteRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'DELETE',
      headers: { ...user, 'Content-Type': 'application/json' },
    })
    expect(deleteRes.status).toBe(204)
    const immediatelyDeletedTaskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, { headers: user })
    expect(immediatelyDeletedTaskRes.status).toBe(404)

    const deleteControlRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(deleteControlRes.status).toBe(200)
    const deleteControl = (await deleteControlRes.json()) as { controls: DownloadTask[] }
    const deleteControlTask = deleteControl.controls.find((item) => item.id === createdTask.id)
    expect(deleteControlTask).toMatchObject({
      status: { state: 'canceled' },
      control: { action: 'delete', requestedAt: expect.any(String) },
    })

    const deleteAckRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ cleanupCompleted: true }),
    })
    expect(deleteAckRes.status).toBe(200)
    await expect(deleteAckRes.json()).resolves.toMatchObject({ status: { state: 'canceled' } })
    const repeatedAckRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ cleanupCompleted: true }),
    })
    expect(repeatedAckRes.status).toBe(200)

    const afterAckRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(afterAckRes.status).toBe(200)
    const afterAck = (await afterAckRes.json()) as { controls: DownloadTask[] }
    expect(afterAck.controls.some((item) => item.id === createdTask.id)).toBe(false)

    const deletedTaskRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, { headers: user })
    expect(deletedTaskRes.status).toBe(404)
    const [deletedTask] = await db.all<{ status: string; deletedAt: number | null }>(sql`
      SELECT status, deleted_at AS deletedAt
      FROM download_tasks
      WHERE id = ${createdTask.id}
    `)
    expect(deletedTask).toMatchObject({ status: 'canceled', deletedAt: expect.any(Number) })
    const deletionEvents = await db.all<{ type: string; toState: string | null }>(sql`
      SELECT
        json_extract(task_event.value, '$.type') AS type,
        json_extract(task_event.value, '$.to') AS toState
      FROM download_tasks task
      JOIN json_each(task.events) AS task_event
      WHERE task.id = ${createdTask.id}
      ORDER BY CAST(task_event.key AS INTEGER)
    `)
    expect(deletionEvents).toEqual(
      expect.arrayContaining([
        { type: 'status_changed', toState: 'queued' },
        { type: 'cleanup_requested', toState: null },
        { type: 'cleanup_completed', toState: null },
      ]),
    )
    expect(deletionEvents.filter((event) => event.toState === 'canceling')).toHaveLength(1)
    expect(deletionEvents.filter((event) => event.toState === 'canceled')).toHaveLength(1)
    expect(deletionEvents.filter((event) => event.type === 'cleanup_completed')).toHaveLength(1)
  })

  it('lets the assigned downloader recover interrupted tasks without resuming user-paused tasks [spec: download-tasks/recover-interrupted]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'interrupted-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-interrupted-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/interrupted.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const queuedTask = (await createTaskRes.json()) as DownloadTask
    const createdTask = await claimTaskForDownloader(app, createdDownloader.token, queuedTask.id)
    expect(createdTask.status.state).toBe('assigned')
    expect(createdTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const interruptedRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'interrupted',
        ...transferProgress({ downloadBytes: 1024, totalBytes: 4096 }),
        runtime: { phase: 'downloading', message: 'Interrupted because the downloader stopped' },
      }),
    })
    expect(interruptedRes.status).toBe(200)
    await expect(interruptedRes.json()).resolves.toMatchObject({
      status: {
        state: 'interrupted',
        progress: { download: { bytes: 1024, totalBytes: 4096 } },
      },
    })

    const interruptedAssignedRes = await app.request('/api/downloads/tasks?assignedTo=me&status=interrupted', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(interruptedAssignedRes.status).toBe(200)
    const interruptedAssigned = (await interruptedAssignedRes.json()) as DownloadTaskList
    const interruptedTask = interruptedAssigned.items.find((item) => item.id === createdTask.id)
    expect(interruptedTask).toMatchObject({ status: { state: 'interrupted' } })
    expect(interruptedTask?.status.assignment?.uploadToken).toBeTruthy()

    const resumedProgressRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading', ...transferProgress({ downloadBytes: 2048, downloadBps: 256 }) }),
    })
    expect(resumedProgressRes.status).toBe(200)
    const resumedProgress = (await resumedProgressRes.json()) as DownloadTask
    expect(resumedProgress).toMatchObject({
      status: { state: 'downloading', progress: { download: { bytes: 2048 } } },
    })
    expect(resumedProgress.status.runtime?.message).toBeUndefined()

    const pauseRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'pausing' } })

    const pausedRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pausedRes.status).toBe(200)

    const pausedProgressRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading', ...transferProgress({ downloadBytes: 3072 }) }),
    })
    expect(pausedProgressRes.status).toBe(409)
    const pausedProgressBody = (await pausedProgressRes.json()) as {
      error: { message: string; details: { reason: string }[] }
    }
    expect(pausedProgressBody.error.message).toBe('Task is paused')
    expect(pausedProgressBody.error.details[0].reason).toBe('INVALID_STATE')
  })

  it('preserves the completed download checkpoint when retrying an upload failure [spec: download-tasks/checkpoint-on-retry]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'retry-checkpoint-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-retry-checkpoint-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc123' },
        targetFolder: 'Media/Music',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const queuedTask = (await createTaskRes.json()) as DownloadTask
    const createdTask = await claimTaskForDownloader(app, createdDownloader.token, queuedTask.id)
    expect(createdTask.status.state).toBe('assigned')

    const totalBytes = 4096
    const failedUploadRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'failed',
        ...transferProgress({ downloadBytes: totalBytes, uploadBytes: 1024, totalBytes }),
        errorMessage: 'confirm object failed',
        runtime: {
          engine: 'aria2',
          phase: 'uploading',
          torrent: { infoHash: 'abc123' },
          message: 'upload token rejected',
        },
      }),
    })
    expect(failedUploadRes.status).toBe(200)
    await expect(failedUploadRes.json()).resolves.toMatchObject({
      status: {
        state: 'failed',
        progress: {
          download: { bytes: totalBytes, totalBytes },
          upload: { bytes: 1024, totalBytes },
        },
        runtime: { phase: 'uploading' },
      },
    })

    const retryRes = await app.request(`/api/downloads/tasks/${createdTask.id}/attempts`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fresh: false }),
    })
    expect(retryRes.status).toBe(201)
    const retriedTask = (await retryRes.json()) as DownloadTask
    expect(retriedTask).toMatchObject({
      status: {
        state: 'queued',
        assignment: null,
        progress: {
          download: { bytes: totalBytes, totalBytes },
          upload: { bytes: 1024, totalBytes },
        },
        runtime: { phase: 'uploading' },
        error: null,
      },
    })
    expect(retriedTask.status.runtime?.message).toBeUndefined()
    await claimTaskForDownloader(app, createdDownloader.token, createdTask.id)

    const assignedRes = await app.request('/api/downloads/tasks?assignedTo=me&status=assigned', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(assignedRes.status).toBe(200)
    const assigned = (await assignedRes.json()) as DownloadTaskList
    const task = assigned.items.find((item) => item.id === createdTask.id)
    expect(task).toMatchObject({
      status: {
        progress: {
          download: { bytes: totalBytes, totalBytes },
          upload: { bytes: 1024, totalBytes },
        },
        runtime: { phase: 'uploading' },
      },
    })
    expect(task?.status.assignment?.uploadToken).toBeTruthy()

    const restartRes = await app.request(`/api/downloads/tasks/${createdTask.id}/attempts`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fresh: true }),
    })
    expect(restartRes.status).toBe(201)
    await expect(restartRes.json()).resolves.toMatchObject({
      status: {
        state: 'queued',
        attempt: 2,
        assignment: null,
        progress: {
          download: { bytes: 0, totalBytes: null },
          upload: { bytes: 0, totalBytes: null },
        },
        runtime: null,
        error: null,
      },
    })
    await claimTaskForDownloader(app, createdDownloader.token, createdTask.id)

    const staleSeedRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        ...transferProgress({ downloadBytes: totalBytes, totalBytes }),
        runtime: {
          phase: 'seeding',
          progress: {
            download: { bytes: totalBytes, totalBytes, bytesPerSecond: 0 },
            upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
          },
          torrent: { infoHash: 'stale-seed' },
        },
      }),
    })
    expect(staleSeedRes.status).toBe(200)
    await expect(staleSeedRes.json()).resolves.toMatchObject({
      status: {
        state: 'assigned',
        attempt: 2,
        progress: {
          download: { bytes: 0, totalBytes: null },
          upload: { bytes: 0, totalBytes: null },
        },
        runtime: null,
      },
    })

    const downloadingAfterRestartRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        ...transferProgress({ downloadBytes: 1024, totalBytes, downloadBps: 256 }),
        runtime: { phase: 'downloading', etaSeconds: 36 },
      }),
    })
    expect(downloadingAfterRestartRes.status).toBe(200)

    const completedAfterRestartRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        runtime: { phase: 'completed' },
      }),
    })
    expect(completedAfterRestartRes.status).toBe(200)
    await expect(completedAfterRestartRes.json()).resolves.toMatchObject({
      status: {
        runtime: { phase: 'completed' },
      },
    })
    const terminalFacts = await db.all<{ outcome: string; count: number }>(sql`
      SELECT json_extract(task_event.value, '$.to') AS outcome, COUNT(*) AS count
      FROM download_tasks task
      JOIN json_each(task.events) AS task_event
      WHERE task.id = ${createdTask.id}
        AND json_extract(task_event.value, '$.type') = 'status_changed'
        AND json_extract(task_event.value, '$.to') IN ('completed', 'failed', 'canceled')
      GROUP BY outcome
      ORDER BY outcome
    `)
    expect(terminalFacts).toEqual([
      { outcome: 'completed', count: 1 },
      { outcome: 'failed', count: 1 },
    ])
    const [systemAuditFacts] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count
      FROM audit_events
      WHERE target_id = ${createdTask.id}
        AND action IN ('download_task_completed', 'download_task_failed', 'download_task_canceled')
    `)
    expect(systemAuditFacts.count).toBe(0)

    const seedingAfterRestartRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        runtime: { phase: 'seeding', seeding: { active: true } },
      }),
    })
    expect(seedingAfterRestartRes.status).toBe(200)
    await expect(seedingAfterRestartRes.json()).resolves.toMatchObject({
      status: {
        runtime: { phase: 'seeding', seeding: { active: true } },
      },
    })
  })

  it('uses transitional states for downloading task pause and cancel actions [spec: download-tasks/transitional-actions]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'transition-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 1 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-transition-actions-user@example.com')
    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/transition.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const queuedTask = (await createTaskRes.json()) as DownloadTask
    const createdTask = await claimTaskForDownloader(app, createdDownloader.token, queuedTask.id, {
      ...heartbeat,
      currentTasks: 1,
    })

    const downloadingRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(downloadingRes.status).toBe(200)

    const pauseRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'pausing' } })

    const pausingProgressRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify(transferProgress({ downloadBytes: 1024 })),
    })
    expect(pausingProgressRes.status).toBe(409)
    const pausingProgressBody = (await pausingProgressRes.json()) as {
      error: { message: string; details: { reason: string }[] }
    }
    expect(pausingProgressBody.error.message).toBe('Task is pausing')
    expect(pausingProgressBody.error.details[0].reason).toBe('INVALID_STATE')

    const pausedRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pausedRes.status).toBe(200)
    await expect(pausedRes.json()).resolves.toMatchObject({ status: { state: 'paused' } })

    const resumeRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'queued' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({
      status: { state: 'queued', assignment: null },
    })
    await claimTaskForDownloader(app, createdDownloader.token, createdTask.id, { ...heartbeat, currentTasks: 1 })

    const rerunRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(rerunRes.status).toBe(200)

    const cancelRes = await app.request(`/api/downloads/tasks/${createdTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: { state: 'canceling' } })

    const canceledRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledRes.status).toBe(200)
    await expect(canceledRes.json()).resolves.toMatchObject({ status: { state: 'canceled' } })

    const commandEvents = await db.all<{ action: string; userId: string; actorType: string }>(sql`
      SELECT action, user_id AS userId, actor_type AS actorType
      FROM audit_events
      WHERE target_type = 'download_task'
        AND target_id = ${createdTask.id}
        AND action IN (
          'download_task_pause_requested',
          'download_task_resume_requested',
          'download_task_cancel_requested'
        )
      ORDER BY created_at, action
    `)
    expect(commandEvents).toEqual(
      expect.arrayContaining([
        { action: 'download_task_pause_requested', userId: createdTask.createdBy, actorType: 'user' },
        { action: 'download_task_resume_requested', userId: createdTask.createdBy, actorType: 'user' },
        { action: 'download_task_cancel_requested', userId: createdTask.createdBy, actorType: 'user' },
      ]),
    )
  })

  it('rejects pause for billing-paused and uploading tasks [spec: download-tasks/reject-invalid-pause]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'pause-rules-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 1 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-pause-rules-user@example.com')
    const createTask = async (uri: string) => {
      const res = await app.request('/api/downloads/tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { type: 'http', uri }, targetFolder: '' }),
      })
      expect(res.status).toBe(201)
      return (await res.json()) as { id: string }
    }

    const billingTask = await createTask('https://example.com/billing-paused.bin')
    await claimTaskForDownloader(app, createdDownloader.token, billingTask.id, { ...heartbeat, currentTasks: 1 })
    const billingUpdateRes = await app.request(`/api/downloads/tasks/${billingTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'suspended' }),
    })
    expect(billingUpdateRes.status).toBe(200)
    const billingPauseRes = await app.request(`/api/downloads/tasks/${billingTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(billingPauseRes.status).toBe(409)

    const uploadingTask = await createTask('https://example.com/uploading.bin')
    await claimTaskForDownloader(app, createdDownloader.token, uploadingTask.id, { ...heartbeat, currentTasks: 1 })
    const uploadingUpdateRes = await app.request(`/api/downloads/tasks/${uploadingTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'uploading' }),
    })
    expect(uploadingUpdateRes.status).toBe(200)
    const uploadingPauseRes = await app.request(`/api/downloads/tasks/${uploadingTask.id}/status`, {
      method: 'PUT',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(uploadingPauseRes.status).toBe(409)
  })

  it('rejects invalid task actions [spec: download-tasks/reject-invalid-action]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const user = await authedHeaders(app, 'invalid-download-actions-user@example.com')

    const createTaskRes = await app.request('/api/downloads/tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/no-downloader.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('queued')

    const deleteRes = await app.request(`/api/downloads/tasks/${createdTask.id}`, {
      method: 'DELETE',
      headers: { ...user, 'Content-Type': 'application/json' },
    })
    expect(deleteRes.status).toBe(409)
    const deleteBody = (await deleteRes.json()) as { error: { message: string; details: { reason: string }[] } }
    expect(deleteBody.error.message).toBe('Only completed, failed, or canceled tasks can be deleted')
    expect(deleteBody.error.details[0].reason).toBe('INVALID_STATE')
  })

  it('sorts and filters download tasks on the server [spec: download-tasks/sort-filter]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const user = await authedHeaders(app, 'download-sort-user@example.com')

    for (const body of [
      {
        source: { type: 'http', uri: 'https://example.com/b.bin' },
        targetFolder: '',
        category: 'video',
        tags: ['bulk', 'movie'],
      },
      {
        source: { type: 'http', uri: 'https://example.com/a.bin' },
        targetFolder: '',
        category: 'archive',
        tags: ['bulk', 'backup'],
      },
    ]) {
      const createTaskRes = await app.request('/api/downloads/tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(createTaskRes.status).toBe(201)
    }

    const categorySortRes = await app.request('/api/downloads/tasks?sortBy=category&sortDir=asc', { headers: user })
    expect(categorySortRes.status).toBe(200)
    const categorySorted = (await categorySortRes.json()) as DownloadTaskList
    expect(categorySorted.items.map((item) => item.spec.labels.category)).toEqual(['archive', 'video'])

    const tagFilterRes = await app.request('/api/downloads/tasks?tag=movie&sortBy=source&sortDir=desc', {
      headers: user,
    })
    expect(tagFilterRes.status).toBe(200)
    const tagFiltered = (await tagFilterRes.json()) as DownloadTaskList
    expect(tagFiltered.items).toHaveLength(1)
    expect(tagFiltered.items[0]).toMatchObject({
      spec: { source: { uri: 'https://example.com/b.bin' }, labels: { tags: ['bulk', 'movie'] } },
    })
  })
})

describe('Downloaders — free plan limit', () => {
  async function postDownloader(
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    admin: Record<string, string>,
    name: string,
  ) {
    return app.request('/api/downloads/downloaders', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, heartbeat }),
    })
  }

  it('blocks the second downloader on the free plan with 402 [spec: download-tasks/free-limit]', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const admin = await adminHeaders(app)

    expect((await postDownloader(app, admin, 'first')).status).toBe(201)

    const second = await postDownloader(app, admin, 'second')
    expect(second.status).toBe(402)
    const body = (await second.json()) as {
      error: { message: string; details: { reason: string; metadata: Record<string, string> }[] }
    }
    expect(body.error.message).toBe('Feature not available')
    expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0].metadata.feature).toBe('downloaders_unlimited')
    expect(body.error.details[0].metadata.limit).toBe('1')
  })

  it('allows additional downloaders with the downloaders_unlimited entitlement [spec: download-tasks/unlimited-entitlement]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    expect((await postDownloader(app, admin, 'first')).status).toBe(201)
    expect((await postDownloader(app, admin, 'second')).status).toBe(201)
  })

  it('updates downloader credit billing through the dedicated route [spec: downloaders/credit-billing]', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await seedBusinessLicense(db)
    const admin = await adminHeaders(app)
    const createRes = await postDownloader(app, admin, 'billable')
    const created = (await createRes.json()) as { downloader: { id: string } }

    const res = await app.request(`/api/downloads/downloaders/${created.downloader.id}/credit-billing`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 2048, creditsPerUnit: 3 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Downloader
    expect(body.remoteDownloadCreditBillingEnabled).toBe(true)
    expect(body.remoteDownloadCreditUnitBytes).toBe(2048)
    expect(body.remoteDownloadCreditPerUnit).toBe(3)
  })

  it('returns 402 when enabling downloader credit billing without quota_store', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const admin = await adminHeaders(app)
    const createRes = await postDownloader(app, admin, 'blocked-billing')
    const created = (await createRes.json()) as { downloader: { id: string } }

    const res = await app.request(`/api/downloads/downloaders/${created.downloader.id}/credit-billing`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 2048, creditsPerUnit: 3 }),
    })
    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: { message: string; details: { reason: string; metadata: Record<string, string> }[] }
    }
    expect(body.error.message).toBe('Feature not available')
    expect(body.error.details[0].reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0].metadata.feature).toBe('quota_store')
  })

  it('returns 404 from downloader credit billing when disabled for a missing downloader', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const admin = await adminHeaders(app)

    const res = await app.request('/api/downloads/downloaders/missing/credit-billing', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, unitBytes: 2048, creditsPerUnit: 3 }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 from downloader credit billing when enabled for a missing downloader without quota_store', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    const res = await app.request('/api/downloads/downloaders/missing/credit-billing', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, unitBytes: 2048, creditsPerUnit: 3 }),
    })
    expect(res.status).toBe(404)
  })
})
