import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createBackgroundJob } from '../services/background-jobs.js'
import { findPersonalOrg } from '../services/org.js'
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
  const headers = await authedHeaders(app.app)
  const [user] = await app.db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, 'test@example.com'))
  const orgId = await findPersonalOrg(app.db, user.id)
  return { headers, userId: user.id, orgId: orgId as string }
}

describe('GET /api/events', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/events')

    expect(res.status).toBe(401)
  })

  it('streams jobs and notifications events for an authed user', async () => {
    const testApp = await createTestApp()
    const { headers, userId, orgId } = await authedOrg(testApp)
    expect(orgId).toBeTruthy()
    await createBackgroundJob(testApp.db, { orgId, userId, type: 'archive_compress' })

    const res = await testApp.app.request('/api/events?downloadTasks=1', { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await readSome(res, ['event: jobs', 'event: notifications'])
    expect(text).toContain('event: jobs')
    expect(text).toContain('"activeCount":1')
    expect(text).toContain('event: notifications')
    expect(text).toContain('"unreadCount":0')
  })

  it('closes the stream when the request is aborted', async () => {
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

  it('emits an error event when a domain query fails', async () => {
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
