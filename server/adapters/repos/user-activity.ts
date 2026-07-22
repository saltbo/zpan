import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { user } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'

export const USER_ACTIVITY_UPDATE_INTERVAL_MS = 5 * 60 * 1000

export async function recordUserActivity(db: Database, userId: string, occurredAt = new Date()): Promise<void> {
  const refreshBefore = new Date(occurredAt.getTime() - USER_ACTIVITY_UPDATE_INTERVAL_MS)
  await db
    .update(user)
    .set({ lastActiveAt: occurredAt, updatedAt: sql`${user.updatedAt}` })
    .where(and(eq(user.id, userId), or(isNull(user.lastActiveAt), lte(user.lastActiveAt, refreshBefore))))
}
