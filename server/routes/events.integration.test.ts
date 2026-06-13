import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createBackgroundJob } from '../services/background-jobs.js'
import { findPersonalOrg } from '../services/org.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

async function readStream(res: Response, untilAll: string[], maxChunks = 8): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
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

describe('GET /api/events', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/events')

    expect(res.status).toBe(401)
  })

  it('streams jobs and notifications events for an authed user', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)

    const [user] = await db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'test@example.com'))
    const orgId = await findPersonalOrg(db, user.id)
    expect(orgId).toBeTruthy()

    await createBackgroundJob(db, { orgId: orgId as string, userId: user.id, type: 'archive_compress' })

    const res = await app.request('/api/events?downloadTasks=1', { headers })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await readStream(res, ['event: jobs', 'event: notifications'])
    expect(text).toContain('event: jobs')
    expect(text).toContain('"activeCount":1')
    expect(text).toContain('event: notifications')
    expect(text).toContain('"unreadCount":0')
  })
})
