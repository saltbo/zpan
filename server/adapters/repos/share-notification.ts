import { eq } from 'drizzle-orm'
import { user } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { ShareNotificationRepo } from '../../usecases/ports'

export function createShareNotificationRepo(db: Database): ShareNotificationRepo {
  return {
    async getUserEmail(userId) {
      const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
      return rows[0]?.email ?? null
    },
  }
}
