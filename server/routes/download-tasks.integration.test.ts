import type { DownloadTask } from '@shared/types'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

type DownloadTaskList = { items: DownloadTask[] }

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
    const task = (await createTaskRes.json()) as DownloadTask
    expect(task.status.state).toBe('assigned')
    expect(task.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const deleteRes = await app.request(`/api/admin/downloaders/${createdDownloader.downloader.id}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(deleteRes.status).toBe(200)
    await expect(deleteRes.json()).resolves.toEqual({ id: createdDownloader.downloader.id, deleted: true })

    const taskRes = await app.request(`/api/download-tasks/${task.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({ status: { state: 'queued', assignment: null } })
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
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('assigned')
    expect(createdTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)
    expect(createdTask.spec.labels.category).toBe('fixtures')
    expect(createdTask.spec.labels.tags).toEqual(['sample', 'http'])
    expect(createdTask.status.assignment?.uploadToken).toBeUndefined()

    const assignedRes = await app.request('/api/download-tasks?assignedTo=me&category=fixtures&tag=http', {
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

    const downloadingRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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

    const recoverDownloadingRes = await app.request('/api/download-tasks?assignedTo=me&status=downloading', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(recoverDownloadingRes.status).toBe(200)
    const recoverDownloading = (await recoverDownloadingRes.json()) as DownloadTaskList
    const recoverDownloadingTask = recoverDownloading.items.find((item) => item.id === createdTask.id)
    expect(recoverDownloadingTask?.status.state).toBe('downloading')
    expect(recoverDownloadingTask?.status.assignment?.uploadToken).toBeTruthy()
    expect(recoverDownloadingTask?.status.assignment?.uploadToken).toBe(assignedTask?.status.assignment?.uploadToken)

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

    const uploadingRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'uploading',
        ...transferProgress({ downloadBytes: 10 * 1024 * 1024, totalBytes: 10 * 1024 * 1024 }),
      }),
    })
    expect(uploadingRes.status).toBe(200)
    const recoverUploadingRes = await app.request('/api/download-tasks?assignedTo=me&status=uploading', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(recoverUploadingRes.status).toBe(200)
    const recoverUploading = (await recoverUploadingRes.json()) as DownloadTaskList
    const recoverUploadingTask = recoverUploading.items.find((item) => item.id === createdTask.id)
    expect(recoverUploadingTask?.status.state).toBe('uploading')
    expect(recoverUploadingTask?.status.assignment?.uploadToken).toBeTruthy()

    const completeTaskRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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

    const taskRes = await app.request(`/api/download-tasks/${createdTask.id}`, { headers: user })
    expect(taskRes.status).toBe(200)
    const task = (await taskRes.json()) as DownloadTask
    expect(task.status.state).toBe('completed')
    expect(task.status.output?.objectId).toBe(object.id)
    expect(task.status.progress.download.bytes).toBe(10 * 1024 * 1024)
    expect(task.status.progress.upload.bytes).toBe(10 * 1024 * 1024)
  })

  it('merges downloader task updates as patches without dropping prior transfer data', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'patch-progress-downloader')
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

    const user = await authedHeaders(app, 'patch-progress-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:patchprogress' },
        targetFolder: 'Remote Downloads',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const task = (await createTaskRes.json()) as DownloadTask

    const totalBytes = 10 * 1024 * 1024
    const downloadingRes = await app.request(`/api/download-tasks/${task.id}`, {
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

    const uploadingRes = await app.request(`/api/download-tasks/${task.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'uploading',
        ...transferProgress({ uploadBytes: 4 * 1024 * 1024, totalBytes, uploadBps: 256_000 }),
        runtime: {
          phase: 'uploading',
          etaSeconds: 24,
        },
      }),
    })
    expect(uploadingRes.status).toBe(200)
    const uploadingTask = (await uploadingRes.json()) as DownloadTask

    expect(uploadingTask.status.progress.download).toMatchObject({
      bytes: totalBytes,
      totalBytes,
      bytesPerSecond: 512_000,
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
        download: { bytes: totalBytes, totalBytes, bytesPerSecond: 512_000 },
        upload: { bytes: 4 * 1024 * 1024, totalBytes, bytesPerSecond: 256_000 },
      },
      torrent: { infoHash: 'patch-info-hash', name: 'patch-progress' },
      trackers: [{ url: 'udp://tracker.example/announce', status: 'working', seeds: 2 }],
    })
  })

  it('returns storage failure details when multipart upload session creation fails', async () => {
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
    const heartbeatRes = await app.request('/api/downloader/heartbeat', {
      method: 'POST',
      headers: downloaderHeaders,
      body: JSON.stringify({ ...heartbeat, currentTasks: 0 }),
    })
    expect(heartbeatRes.status).toBe(200)
    const user = await authedHeaders(app, 'multipart-failure-user@example.com')

    const taskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:multipartfail' },
        targetFolder: 'Remote Downloads',
      }),
    })
    expect(taskRes.status).toBe(201)
    const tasksRes = await app.request('/api/download-tasks?assignedTo=me&status=assigned', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    const tasks = (await tasksRes.json()) as DownloadTaskList
    const uploadHeaders = {
      Authorization: `Bearer ${tasks.items[0].status.assignment?.uploadToken}`,
      'Content-Type': 'application/json',
    }
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
    expect(createObjectRes.status).toBe(201)
    const object = (await createObjectRes.json()) as { id: string }

    const sessionRes = await app.request(`/api/objects/${object.id}/uploads`, {
      method: 'POST',
      headers: uploadHeaders,
      body: JSON.stringify({ partSize: 64 * 1024 * 1024 }),
    })

    expect(sessionRes.status).toBe(502)
    await expect(sessionRes.json()).resolves.toEqual({
      error: 'Storage multipart upload failed: bucket does not support multipart',
    })
  })

  it('normalizes target folder paths when creating download tasks', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    await registerDownloaderThroughDeviceLogin(app, 'target-folder-downloader')
    const user = await authedHeaders(app, 'target-folder-user@example.com')

    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/fixture.txt' },
        targetFolder: '/media//Movies/',
      }),
    })

    expect(createTaskRes.status).toBe(201)
    await expect(createTaskRes.json()).resolves.toMatchObject({
      spec: { destination: { folder: 'media/Movies' } },
    })

    const rows = await db.all<{ target_folder: string }>(
      sql`SELECT target_folder FROM download_tasks ORDER BY created_at DESC LIMIT 1`,
    )
    expect(rows[0].target_folder).toBe('media/Movies')
  })

  it('returns storage failure details when multipart upload completion fails', async () => {
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
    const object = (await createObjectRes.json()) as { id: string }

    const sessionRes = await app.request(`/api/objects/${object.id}/uploads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ partSize: 64 * 1024 * 1024 }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string }

    const completeRes = await app.request(`/api/objects/${object.id}/uploads/${session.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ action: 'complete', parts: [{ partNumber: 1, etag: '"etag-1"' }] }),
    })

    expect(completeRes.status).toBe(502)
    await expect(completeRes.json()).resolves.toEqual({
      error: 'Storage multipart upload complete failed: InvalidPart: part missing',
    })
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
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('assigned')
    expect(createdTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const pauseRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'paused' } })

    const pausedAssignedRes = await app.request('/api/download-tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(pausedAssignedRes.status).toBe(200)
    const pausedAssigned = (await pausedAssignedRes.json()) as DownloadTaskList
    expect(pausedAssigned.items.find((item) => item.id === createdTask.id)?.status.state).toBe('paused')

    const pausedProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify(transferProgress({ downloadBytes: 1024, downloadBps: 512 })),
    })
    expect(pausedProgressRes.status).toBe(409)
    await expect(pausedProgressRes.json()).resolves.toEqual({ error: 'Task is paused' })

    const resumeRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({ status: { state: 'assigned' } })

    const cancelRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: { state: 'canceling' } })

    const canceledAssignedRes = await app.request('/api/download-tasks?assignedTo=me', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(canceledAssignedRes.status).toBe(200)
    const canceledAssigned = (await canceledAssignedRes.json()) as DownloadTaskList
    expect(canceledAssigned.items.find((item) => item.id === createdTask.id)?.status.state).toBe('canceling')

    const canceledAckRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledAckRes.status).toBe(200)
    await expect(canceledAckRes.json()).resolves.toMatchObject({ status: { state: 'canceled' } })

    const canceledCompleteRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({
        status: 'completed',
        ...transferProgress({ downloadBytes: 2048, uploadBytes: 2048, totalBytes: 2048 }),
      }),
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

  it('lets the assigned downloader recover interrupted tasks without resuming user-paused tasks', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'interrupted-downloader')
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

    const user = await authedHeaders(app, 'download-interrupted-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'http', uri: 'https://example.com/interrupted.bin' },
        targetFolder: '',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('assigned')
    expect(createdTask.status.assignment?.downloaderId).toBe(createdDownloader.downloader.id)

    const interruptedRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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

    const interruptedAssignedRes = await app.request('/api/download-tasks?assignedTo=me&status=interrupted', {
      headers: { Authorization: `Bearer ${createdDownloader.token}` },
    })
    expect(interruptedAssignedRes.status).toBe(200)
    const interruptedAssigned = (await interruptedAssignedRes.json()) as DownloadTaskList
    const interruptedTask = interruptedAssigned.items.find((item) => item.id === createdTask.id)
    expect(interruptedTask).toMatchObject({ status: { state: 'interrupted' } })
    expect(interruptedTask?.status.assignment?.uploadToken).toBeTruthy()

    const resumedProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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

    const pauseRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'pausing' } })

    const pausedRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pausedRes.status).toBe(200)

    const pausedProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading', ...transferProgress({ downloadBytes: 3072 }) }),
    })
    expect(pausedProgressRes.status).toBe(409)
    await expect(pausedProgressRes.json()).resolves.toEqual({ error: 'Task is paused' })
  })

  it('preserves the completed download checkpoint when retrying an upload failure', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)

    const createdDownloader = await registerDownloaderThroughDeviceLogin(app, 'retry-checkpoint-downloader')
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

    const user = await authedHeaders(app, 'download-retry-checkpoint-user@example.com')
    const createTaskRes = await app.request('/api/download-tasks', {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc123' },
        targetFolder: 'Media/Music',
      }),
    })
    expect(createTaskRes.status).toBe(201)
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('assigned')

    const totalBytes = 4096
    const failedUploadRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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

    const retryRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry' }),
    })
    expect(retryRes.status).toBe(200)
    const retriedTask = (await retryRes.json()) as DownloadTask
    expect(retriedTask).toMatchObject({
      status: {
        state: 'assigned',
        assignment: { downloaderId: createdDownloader.downloader.id },
        progress: {
          download: { bytes: totalBytes, totalBytes },
          upload: { bytes: 1024, totalBytes },
        },
        runtime: { phase: 'uploading' },
        error: null,
      },
    })
    expect(retriedTask.status.runtime?.message).toBeUndefined()

    const assignedRes = await app.request('/api/download-tasks?assignedTo=me&status=assigned', {
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

    const restartRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restart' }),
    })
    expect(restartRes.status).toBe(200)
    await expect(restartRes.json()).resolves.toMatchObject({
      status: {
        state: 'assigned',
        attempt: 2,
        assignment: { downloaderId: createdDownloader.downloader.id },
        progress: {
          download: { bytes: 0, totalBytes: null },
          upload: { bytes: 0, totalBytes: null },
        },
        runtime: null,
        error: null,
      },
    })

    const staleSeedRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
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
  })

  it('uses transitional states for downloading task pause and cancel actions', async () => {
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
    const createdTask = (await createTaskRes.json()) as DownloadTask

    const downloadingRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(downloadingRes.status).toBe(200)

    const pauseRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pauseRes.status).toBe(200)
    await expect(pauseRes.json()).resolves.toMatchObject({ status: { state: 'pausing' } })

    const pausingProgressRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify(transferProgress({ downloadBytes: 1024 })),
    })
    expect(pausingProgressRes.status).toBe(409)
    await expect(pausingProgressRes.json()).resolves.toEqual({ error: 'Task is pausing' })

    const pausedRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'paused' }),
    })
    expect(pausedRes.status).toBe(200)
    await expect(pausedRes.json()).resolves.toMatchObject({ status: { state: 'paused' } })

    const resumeRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resumeRes.status).toBe(200)
    await expect(resumeRes.json()).resolves.toMatchObject({
      status: { state: 'assigned', assignment: { downloaderId: createdDownloader.downloader.id } },
    })

    const rerunRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'downloading' }),
    })
    expect(rerunRes.status).toBe(200)

    const cancelRes = await app.request(`/api/download-tasks/${createdTask.id}/actions`, {
      method: 'POST',
      headers: { ...user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)
    await expect(cancelRes.json()).resolves.toMatchObject({ status: { state: 'canceling' } })

    const canceledRes = await app.request(`/api/download-tasks/${createdTask.id}`, {
      method: 'PATCH',
      headers: downloaderHeaders,
      body: JSON.stringify({ status: 'canceled' }),
    })
    expect(canceledRes.status).toBe(200)
    await expect(canceledRes.json()).resolves.toMatchObject({ status: { state: 'canceled' } })
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
      body: JSON.stringify({ status: 'suspended' }),
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
    const createdTask = (await createTaskRes.json()) as DownloadTask
    expect(createdTask.status.state).toBe('queued')

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
    const categorySorted = (await categorySortRes.json()) as DownloadTaskList
    expect(categorySorted.items.map((item) => item.spec.labels.category)).toEqual(['archive', 'video'])

    const tagFilterRes = await app.request('/api/download-tasks?tag=movie&sortBy=source&sortDir=desc', {
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
