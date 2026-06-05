import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'createMultipartUpload').mockResolvedValue('upload-1')
  vi.spyOn(S3Service.prototype, 'presignUploadPart').mockResolvedValue('https://presigned-part.example.com')
  vi.spyOn(S3Service.prototype, 'completeMultipartUpload').mockResolvedValue(undefined)
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

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (
      id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      'remote-download-storage', 'Remote Download Storage', 'private', 'test-bucket',
      'https://s3.example.com', 'auto', 'test-access-key', 'test-secret-key',
      '$UID/$RAW_NAME', '', 0, 0, 'active', 0, ${100 * 1024 * 1024}, 1, ${now}, ${now}
    )
  `)
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
    body: JSON.stringify({ client_id: 'zpan-downloader', scope: 'downloader:register' }),
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
      client_id: 'zpan-downloader',
    }),
  })
  expect(tokenRes.status).toBe(200)
  const token = (await tokenRes.json()) as { access_token: string }

  const createDownloaderRes = await app.request('/api/admin/downloaders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, heartbeat }),
  })
  expect(createDownloaderRes.status).toBe(201)
  return createDownloaderRes.json() as Promise<{ downloader: { id: string; name: string }; token: string }>
}

describe('Download tasks API integration', () => {
  it('registers a downloader through BetterAuth device login', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const created = await registerDownloaderThroughDeviceLogin(app, 'device-login-downloader')
    expect(created.downloader.name).toBe('device-login-downloader')
    expect(created.token).toBeTruthy()
  })

  it('deletes a downloader and returns unfinished tasks to the queue', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const admin = await adminHeaders(app)
    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'delete-me', admin)
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    expect(
      await app.request('/api/downloader/heartbeat', {
        method: 'POST',
        headers: downloaderHeaders,
        body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
      }),
    ).toHaveProperty('status', 200)

    const user = await authedHeaders(app, 'delete-downloader-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/delete-me.txt' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as { id: string; status: string; assignedDownloaderId: string }
    expect(task.status).toBe('assigned')
    expect(task.assignedDownloaderId).toBe(createdDownloader.downloader.id)

    const deleteRes = await app.request(`/api/admin/downloaders/${createdDownloader.downloader.id}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(deleteRes.status).toBe(200)
    await expect(deleteRes.json()).resolves.toEqual({ id: createdDownloader.downloader.id, deleted: true })

    const taskRes = await app.request(`/api/download-tasks/${task.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({ status: 'queued', assignedDownloaderId: null })
  })

  it('runs the remote download task upload flow through the standard object upload API', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'vps-1')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }

    const heartbeatRes = await app.request('/api/downloader/heartbeat', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0, downloadBps: 128_000 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'downloader-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
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
    const createdTask = (await createTaskRes.json()) as {
      id: string
      assignedDownloaderId: string
      status: string
      category: string
      tags: string[]
      uploadToken?: string
    }
    expect(createdTask.status).toBe('assigned')
    expect(createdTask.assignedDownloaderId).toBe(createdDownloader.downloader.id)
    expect(createdTask.category).toBe('fixtures')
    expect(createdTask.tags).toEqual(['sample', 'http'])
    expect(createdTask.uploadToken).toBeUndefined()

    const assignedRes = await app.request('/api/download-tasks?assignedTo=me&category=fixtures&tag=http', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(assignedRes.status).toBe(200)
    const assigned = (await assignedRes.json()) as {
      items: Array<{ id: string; uploadToken?: string; status: string; category: string; tags: string[] }>
    }
    const assignedTask = assigned.items.find((item) => item.id === createdTask.id)
    expect(assignedTask?.status).toBe('assigned')
    expect(assignedTask?.category).toBe('fixtures')
    expect(assignedTask?.tags).toEqual(['sample', 'http'])
    expect(assignedTask?.uploadToken).toBeTruthy()
    const uploadHeaders = {
      Authorization: `Bearer ${assignedTask?.uploadToken}`,
      'Content-Type': 'application/json',
    }

    const runningRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'running',
        downloadedBytes: 10 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        downloadBps: 512_000,
        detail: {
          engine: 'aria2',
          phase: 'downloading',
          engineState: 'active',
          etaSeconds: 42,
          infoHash: 'abc123',
          torrentName: 'fixture',
          connections: 8,
          seeders: 3,
          trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 3, peers: 8 }],
          peerSamples: [{ address: '127.0.0.1:6881', client: 'libtorrent', progress: 0.5, downloadBps: 128_000 }],
          files: [{ path: 'fixture.txt', size: 10 * 1024 * 1024, completedBytes: 5 * 1024 * 1024 }],
        },
      }),
    })
    expect(runningRes.status).toBe(200)
    const runningTask = (await runningRes.json()) as {
      detail: { engine: string; etaSeconds: number; infoHash: string; trackers: Array<{ url: string }> }
    }
    expect(runningTask.detail.engine).toBe('aria2')
    expect(runningTask.detail.etaSeconds).toBe(42)
    expect(runningTask.detail.infoHash).toBe('abc123')
    expect(runningTask.detail.trackers[0].url).toBe('udp://tracker.example/announce')

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
    const nestedObject = (await createNestedObjectRes.json()) as { id: string; status: string; uploadUrl: string }
    expect(nestedObject.status).toBe('draft')
    expect(nestedObject.uploadUrl).toBe('https://presigned-upload.example.com')

    const nestedConfirmRes = await app.request(`/api/objects/${nestedObject.id}`, {
      method: 'PATCH',
      headers: uploadHeaders,
      body: JSON.stringify({ action: 'confirm', onConflict: 'fail' }),
    })
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
    const object = (await createObjectRes.json()) as { id: string; status: string; uploadUrl: string }
    expect(object.status).toBe('draft')
    expect(object.uploadUrl).toBe('https://presigned-upload.example.com')

    const sessionRes = await app.request(`/api/objects/${object.id}/uploads`, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({ partSize: 5 * 1024 * 1024 }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string; uploadId: string; status: string }
    expect(session.uploadId).toBe('upload-1')
    expect(session.status).toBe('active')

    const partsRes = await app.request(`/api/objects/${object.id}/uploads/${session.id}/parts`, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({ partNumbers: [1] }),
    })
    expect(partsRes.status).toBe(200)
    const parts = (await partsRes.json()) as { parts: Array<{ partNumber: number; url: string }> }
    expect(parts.parts).toEqual([{ partNumber: 1, url: 'https://presigned-part.example.com' }])

    const completeUploadRes = await app.request(`/api/objects/${object.id}/uploads/${session.id}`, {
      method: 'PATCH',
      headers: uploadHeaders,
      body: JSON.stringify({ action: 'complete', parts: [{ partNumber: 1, etag: 'etag-1' }] }),
    })
    expect(completeUploadRes.status).toBe(200)

    const confirmRes = await app.request(`/api/objects/${object.id}`, {
      method: 'PATCH',
      headers: uploadHeaders,
      body: JSON.stringify({ action: 'confirm', onConflict: 'fail' }),
    })
    expect(confirmRes.status).toBe(200)
    const confirmed = (await confirmRes.json()) as { id: string; status: string }
    expect(confirmed.status).toBe('active')

    const completeTaskRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        downloadedBytes: 10 * 1024 * 1024,
        storageUploadedBytes: 10 * 1024 * 1024,
        totalBytes: 10 * 1024 * 1024,
        resultObjectId: object.id,
      }),
    })
    expect(completeTaskRes.status).toBe(200)

    const taskRes = await app.request(`/api/download-tasks/${createdTask.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    const task = (await taskRes.json()) as {
      status: string
      resultObjectId: string
      downloadedBytes: number
      storageUploadedBytes: number
    }
    expect(task.status).toBe('completed')
    expect(task.resultObjectId).toBe(object.id)
    expect(task.downloadedBytes).toBe(10 * 1024 * 1024)
    expect(task.storageUploadedBytes).toBe(10 * 1024 * 1024)
  })

  it('submits user task actions through downloader polling state', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'action-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloader/heartbeat', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-actions-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/actions.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as { id: string; status: string; assignedDownloaderId: string }
    expect(createdTask.status).toBe('assigned')
    expect(createdTask.assignedDownloaderId).toBe(createdDownloader.downloader.id)

    const pauseRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: 'paused' })

    const pausedAssignedRes = await app.request('/api/download-tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(pausedAssignedRes.status).toBe(200)
    const pausedAssigned = (await pausedAssignedRes.json()) as { items: Array<{ id: string; status: string }> }
    expect(pausedAssigned.items.find((item) => item.id === createdTask.id)?.status).toBe('paused')

    const pausedProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ downloadedBytes: 1024, downloadBps: 512 }),
    })
    expect(pausedProgressRes.status).toBe(409)
    await expect(pausedProgressRes.json()).resolves.toEqual({ error: 'Task is paused' })

    const resumeRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({ status: 'assigned' })

    const cancelRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: 'canceling' })

    const canceledAssignedRes = await app.request('/api/download-tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(canceledAssignedRes.status).toBe(200)
    const canceledAssigned = (await canceledAssignedRes.json()) as { items: Array<{ id: string; status: string }> }
    expect(canceledAssigned.items.find((item) => item.id === createdTask.id)?.status).toBe('canceling')

    const canceledAckRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledAckRes.status).toBe(200)
    await expect(canceledAckRes.json()).resolves.toMatchObject({ status: 'canceled' })

    const canceledCompleteRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'completed', downloadedBytes: 2048, storageUploadedBytes: 2048 }),
    })
    expect(canceledCompleteRes.status).toBe(409)
    await expect(canceledCompleteRes.json()).resolves.toEqual({ error: 'Task is canceled' })

    const deleteRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
    expect(deleteRes.status).toBe(200)
    await expect(deleteRes.json()).resolves.toEqual({ id: createdTask.id, deleted: true })
  })

  it('uses transitional states for running task pause and cancel actions', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'transition-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloader/heartbeat', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 1 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-transition-actions-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/transition.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as { id: string; status: string }

    const runningRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'running' }),
    })
    expect(runningRes.status).toBe(200)

    const pauseRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: 'pausing' })

    const pausingProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ downloadedBytes: 1024 }),
    })
    expect(pausingProgressRes.status).toBe(409)
    await expect(pausingProgressRes.json()).resolves.toEqual({ error: 'Task is pausing' })

    const pausedRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pausedRes.status).toBe(200)
    await expect(pausedRes.json()).resolves.toMatchObject({ status: 'paused' })

    const resumeRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({
      status: 'assigned',
      assignedDownloaderId: createdDownloader.downloader.id,
    })

    const rerunRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'running' }),
    })
    expect(rerunRes.status).toBe(200)

    const cancelRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: 'canceling' })

    const canceledRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledRes.status).toBe(200)
    await expect(canceledRes.json()).resolves.toMatchObject({ status: 'canceled' })
  })

  it('rejects pause for billing-paused and uploading tasks', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'pause-rules-downloader')
    const downloaderHeaders = {
      Authorization: `Bearer ${createdDownloader.token}`,
      'Content-Type': 'application/json',
    }
    const heartbeatRes = await app.request('/api/downloader/heartbeat', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 1 }),
    })
    expect(heartbeatRes.status).toBe(200)

    const user = await authedHeaders(app, 'download-pause-rules-user@example.com')
    const createTask = async (uri: string) => {
      const res = await app.request('/api/download-tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { type: 'http', uri }, targetFolder: '' }),
      })
      expect(res.status).toBe(201)
      return (await res.json()) as { id: string }
    }

    const billingTask = await createTask('https://example.com/billing-paused.bin')
    const billingUpdateRes = await app.request(`/api/download-tasks/${billingTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'billing_paused' }),
    })
    expect(billingUpdateRes.status).toBe(200)
    const billingPauseRes = await app.request(`/api/download-tasks/${billingTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(billingPauseRes.status).toBe(409)

    const uploadingTask = await createTask('https://example.com/uploading.bin')
    const uploadingUpdateRes = await app.request(`/api/download-tasks/${uploadingTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'uploading' }),
    })
    expect(uploadingUpdateRes.status).toBe(200)
    const uploadingPauseRes = await app.request(`/api/download-tasks/${uploadingTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(uploadingPauseRes.status).toBe(409)
  })

  it('rejects invalid task actions', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const user = await authedHeaders(app, 'invalid-download-actions-user@example.com')

    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/no-downloader.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as { id: string; status: string }
    expect(createdTask.status).toBe('queued')

    const deleteRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    })
    expect(deleteRes.status).toBe(409)
    await expect(deleteRes.json()).resolves.toMatchObject({
      error: 'Only completed, failed, or canceled tasks can be deleted',
    })
  })

  it('sorts and filters download tasks on the server', async () => {
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
      const createTaskRes = await app.request('/api/download-tasks', {
        method: 'POST',
        headers: { ...user, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(createTaskRes.status).toBe(201)
    }

    const categorySortRes = await app.request('/api/download-tasks?sortBy=category&sortDir=asc', { headers: user })
    expect(categorySortRes.status).toBe(200)
    const categorySorted = (await categorySortRes.json()) as { items: Array<{ category: string }> }
    expect(categorySorted.items.map((item) => item.category)).toEqual(['archive', 'video'])

    const tagFilterRes = await app.request('/api/download-tasks?tag=movie&sortBy=source&sortDir=desc', {
      headers: user,
    })
    expect(tagFilterRes.status).toBe(200)
    const tagFiltered = (await tagFilterRes.json()) as { items: Array<{ sourceUri: string; tags: string[] }> }
    expect(tagFiltered.items).toHaveLength(1)
    expect(tagFiltered.items[0]).toMatchObject({ sourceUri: 'https://example.com/b.bin', tags: ['bulk', 'movie'] })
  })
})
