import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { user } from '../../db/auth-schema.js'
import { createTestApp } from '../../test/setup.js'
import { recordUserActivity } from './user-activity.js'

describe('user activity repository', () => {
  it('advances lastActiveAt once per interval without changing profile updatedAt', async () => {
    const { app, db } = await createTestApp()
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Active User', email: 'activity@example.com', password: 'password123456' }),
    })
    const { user: createdUser } = (await signUp.json()) as { user: { id: string } }
    const initialActivity = new Date('2026-07-21T12:00:00.000Z')
    const profileUpdatedAt = new Date('2026-07-01T00:00:00.000Z')
    await db.run(sql`
      UPDATE user
      SET last_active_at = ${initialActivity.getTime()}, updated_at = ${profileUpdatedAt.getTime()}
      WHERE id = ${createdUser.id}
    `)

    await recordUserActivity(db, createdUser.id, new Date('2026-07-21T12:04:59.999Z'))
    const [beforeRefresh] = await db
      .select({ lastActiveAt: user.lastActiveAt, updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, createdUser.id))
    expect(beforeRefresh).toEqual({ lastActiveAt: initialActivity, updatedAt: profileUpdatedAt })

    const refreshedAt = new Date('2026-07-21T12:05:00.000Z')
    await recordUserActivity(db, createdUser.id, refreshedAt)
    const [afterRefresh] = await db
      .select({ lastActiveAt: user.lastActiveAt, updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, createdUser.id))
    expect(afterRefresh).toEqual({ lastActiveAt: refreshedAt, updatedAt: profileUpdatedAt })

    await recordUserActivity(db, createdUser.id, initialActivity)
    const [afterOlderActivity] = await db
      .select({ lastActiveAt: user.lastActiveAt, updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, createdUser.id))
    expect(afterOlderActivity).toEqual({ lastActiveAt: refreshedAt, updatedAt: profileUpdatedAt })
  })
})
