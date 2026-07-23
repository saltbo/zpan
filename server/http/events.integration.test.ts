import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createBackgroundJobRepo } from '../adapters/repos/background-job.js'
import { createOrgRepo } from '../adapters/repos/org.js'
import * as authSchema from '../db/auth-schema.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

const decoder = new TextDecoder()

async function readSome(res: Response, untilAll: string[], maxChunks = 8): Promise<string> {
  const reader = res.body!.getReader()
  let text = ''
  try {
    for (let i = 0; i < maxChunks; i++) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (untilAll.every((needle) => text.includes(needle))) break
    }
  } finally {
    await reader.cancel()
  }
  return text
}

async function authedOrg(app: Awaited<ReturnType<typeof createTestApp>>) {
  return authedOrgFor(app, 'test@example.com')
}

async function authedOrgFor(app: Awaited<ReturnType<typeof createTestApp>>, email: string) {
  const headers = await authedHeaders(app.app, email)
  const [user] = await app.db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email))
  const orgId = await createOrgRepo(app.db).findPersonalOrg(user.id)
  return { headers, userId: user.id, orgId: orgId as string }
}

async function createOrgApiKey(
  auth: Awaited<ReturnType<typeof createTestApp>>['auth'],
  orgId: string,
  userId: string,
  permissions: Record<string, string[]>,
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: {
      configId: 'remote-download',
      organizationId: orgId,
      userId,
      permissions,
    },
  })) as { key: string }
  return result.key
}

async function insertDownloadTask(
  app: Awaited<ReturnType<typeof createTestApp>>,
  input: { id: string; orgId: string; userId: string; sourceUri: string },
) {
  await app.deps.downloadTasks.insert({
    id: input.id,
    orgId: input.orgId,
    createdByUserId: input.userId,
    sourceType: 'http',
    sourceUri: input.sourceUri,
    displayName: `${input.id}.bin`,
    targetFolder: '',
    category: null,
    tags: [],
    assignedDownloaderId: null,
    status: 'queued',
    assignedAt: null,
    now: new Date(),
  })
}

describe('GET /api/events', () => {
  it('requires authentication [spec: events/auth-required]', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/events')

    expect(res.status).toBe(401)
  })

  it('streams jobs, notifications, and opted-in download tasks for an authed user [spec: events/stream]', async () => {
    const testApp = await createTestApp()
    const { headers, userId, orgId } = await authedOrg(testApp)
    expect(orgId).toBeTruthy()
    await createBackgroundJobRepo(testApp.db).create({ orgId, userId, type: 'archive_compress' })
    await insertDownloadTask(testApp, {
      id: 'browser-org-task',
      orgId,
      userId,
      sourceUri: 'https://example.com/browser-org-task.bin',
    })

    const res = await testApp.app.request('/api/events?downloadTasks=1', { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await readSome(res, ['event: jobs', 'event: notifications', 'event: download-tasks'])
    expect(text).toContain('event: jobs')
    expect(text).toContain('"activeCount":1')
    expect(text).toContain('event: notifications')
    expect(text).toContain('"unreadCount":0')
    expect(text).toContain('event: download-tasks')
    expect(text).toContain('browser-org-task')
  })

  it('streams only scoped download tasks to an authorized workspace API key [spec: events/api-key-download-tasks]', async () => {
    const testApp = await createTestApp()
    const keyOwner = await authedOrgFor(testApp, 'api-key-owner@example.com')
    const otherOrg = await authedOrgFor(testApp, 'other-org-owner@example.com')
    const key = await createOrgApiKey(testApp.auth, keyOwner.orgId, keyOwner.userId, {
      remoteDownload: ['read'],
    })
    await insertDownloadTask(testApp, {
      id: 'authorized-org-task',
      orgId: keyOwner.orgId,
      userId: keyOwner.userId,
      sourceUri: 'https://example.com/authorized-org-task.bin',
    })
    await insertDownloadTask(testApp, {
      id: 'other-org-task',
      orgId: otherOrg.orgId,
      userId: otherOrg.userId,
      sourceUri: 'https://example.com/other-org-task.bin',
    })
    await createBackgroundJobRepo(testApp.db).create({
      orgId: keyOwner.orgId,
      userId: keyOwner.userId,
      type: 'archive_compress',
    })

    const res = await testApp.app.request('/api/events?downloadTasks=1', {
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await readSome(res, ['event: download-tasks'])
    expect(text).toContain('event: download-tasks')
    expect(text).toContain('authorized-org-task')
    expect(text).not.toContain('other-org-task')
    expect(text).not.toContain('event: notifications')
    expect(text).not.toContain('event: jobs')
  })

  it('forbids a workspace API key without remoteDownload read [spec: events/api-key-permission-denied]', async () => {
    const testApp = await createTestApp()
    const keyOwner = await authedOrgFor(testApp, 'api-key-no-read@example.com')
    const key = await createOrgApiKey(testApp.auth, keyOwner.orgId, keyOwner.userId, {
      remoteDownload: ['create'],
    })

    const res = await testApp.app.request('/api/events?downloadTasks=1', {
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(res.status).toBe(403)
  })

  it('forbids an authorized workspace API key without the downloadTasks opt-in [spec: events/api-key-download-tasks-required]', async () => {
    const testApp = await createTestApp()
    const keyOwner = await authedOrgFor(testApp, 'api-key-no-opt-in@example.com')
    const key = await createOrgApiKey(testApp.auth, keyOwner.orgId, keyOwner.userId, {
      remoteDownload: ['read'],
    })

    const res = await testApp.app.request('/api/events', {
      headers: { Authorization: `Bearer ${key}` },
    })

    expect(res.status).toBe(403)
  })

  it('rejects invalid credentials [spec: events/api-key-invalid]', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/events?downloadTasks=1', {
      headers: { Authorization: 'Bearer invalid-api-key' },
    })

    expect(res.status).toBe(401)
  })

  it('closes the stream when the request is aborted [spec: events/abort]', async () => {
    const testApp = await createTestApp()
    const { headers } = await authedOrg(testApp)

    const controller = new AbortController()
    const res = await testApp.app.request('/api/events', { headers, signal: controller.signal })
    const reader = res.body!.getReader()

    // First read starts the stream and registers the abort listener.
    const first = await reader.read()
    expect(decoder.decode(first.value)).toContain('event: notifications')

    controller.abort()
    const next = await reader.read()
    expect(next.done).toBe(true)
  })

  it('emits an error event when a domain query fails [spec: events/error-event]', async () => {
    const testApp = await createTestApp()
    const { headers } = await authedOrg(testApp)
    vi.spyOn(testApp.deps.notifications, 'unreadCount').mockRejectedValueOnce(new Error('boom'))

    const res = await testApp.app.request('/api/events', { headers })
    const text = await readSome(res, ['event: error'])

    expect(text).toContain('event: error')
    expect(text).toContain('boom')
    vi.restoreAllMocks()
  })
})
