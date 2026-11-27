import { sql } from 'drizzle-orm'
import { expect } from 'vitest'
import { adminHeaders, type createTestApp } from './setup'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

const downloaderHeartbeat = {
  version: '1.0.0',
  hostname: 'host',
  platform: 'linux',
  arch: 'x64',
  engine: 'aria2',
  capabilities: ['http', 'magnet', 'torrent'],
  maxConcurrentTasks: 2,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024 * 1024 * 1024,
}

// Registers a downloader, creates a task, lets heartbeat claim it, and returns
// the upload token plus the task's target folder. The token authenticates as a
// `download-task-upload` principal scoped to that task/folder.
export async function mintTaskUploadContext(
  app: TestApp,
  db: TestDb,
  opts: { targetFolder: string },
): Promise<{ uploadToken: string; targetFolder: string; orgId: string; taskId: string; downloaderToken: string }> {
  const admin = await adminHeaders(app)
  const codeRes = await app.request('/api/auth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'zpan-cli', scope: 'downloader:register' }),
  })
  const code = (await codeRes.json()) as { device_code: string; user_code: string }
  await app.request(`/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`, { headers: admin })
  await app.request('/api/auth/device/approve', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode: code.user_code }),
  })
  const tokenRes = await app.request('/api/auth/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.device_code,
      client_id: 'zpan-cli',
    }),
  })
  const cliToken = (await tokenRes.json()) as { access_token: string }
  const downloaderHeaders = { Authorization: `Bearer ${cliToken.access_token}`, 'Content-Type': 'application/json' }
  const createDownloaderRes = await app.request('/api/downloads/downloaders', {
    method: 'POST',
    headers: downloaderHeaders,
    body: JSON.stringify({ name: 'object-error-downloader', heartbeat: downloaderHeartbeat }),
  })
  const downloader = (await createDownloaderRes.json()) as { token: string }
  await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...downloaderHeartbeat, currentTasks: 0 }),
  })

  const user = await adminHeaders(app)
  const createTaskRes = await app.request('/api/downloads/tasks', {
    method: 'POST',
    headers: { ...user, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { type: 'http', uri: 'https://example.com/file.txt' },
      targetFolder: opts.targetFolder,
      name: 'file.txt',
    }),
  })
  expect(createTaskRes.status).toBe(201)

  const assignedRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...downloaderHeartbeat, currentTasks: 0 }),
  })
  const assigned = (await assignedRes.json()) as {
    assignments: Array<{ id: string; status: { assignment?: { uploadToken?: string } } }>
  }
  const uploadToken = assigned.assignments[0]?.status.assignment?.uploadToken
  if (!uploadToken) throw new Error('upload_token_missing')
  const orgRows = await db.all<{ orgId: string }>(sql`SELECT org_id AS orgId FROM download_tasks LIMIT 1`)
  return {
    uploadToken,
    targetFolder: opts.targetFolder,
    orgId: orgRows[0].orgId,
    taskId: assigned.assignments[0].id,
    downloaderToken: downloader.token,
  }
}

// Assigns one more task to the downloader behind `context`, so two tasks run on
// the same downloader, and returns that task's upload token.
export async function mintSiblingTaskUploadToken(
  app: TestApp,
  context: { downloaderToken: string; targetFolder: string; taskId: string },
): Promise<{ uploadToken: string; taskId: string }> {
  const user = await adminHeaders(app)
  const createTaskRes = await app.request('/api/downloads/tasks', {
    method: 'POST',
    headers: { ...user, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { type: 'http', uri: 'https://example.com/sibling.txt' },
      targetFolder: context.targetFolder,
      name: 'sibling.txt',
    }),
  })
  expect(createTaskRes.status).toBe(201)
  const assignedRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${context.downloaderToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...downloaderHeartbeat, currentTasks: 1 }),
  })
  const assigned = (await assignedRes.json()) as {
    assignments: Array<{ id: string; status: { assignment?: { uploadToken?: string } } }>
  }
  const sibling = assigned.assignments.find((assignment) => assignment.id !== context.taskId)
  const uploadToken = sibling?.status.assignment?.uploadToken
  if (!sibling || !uploadToken) throw new Error('sibling_upload_token_missing')
  return { uploadToken, taskId: sibling.id }
}
