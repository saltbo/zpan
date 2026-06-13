import { eq } from 'drizzle-orm'
import { user } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { ProfileRepo } from '../../usecases/ports'

export function createProfileRepo(db: Database): ProfileRepo {
  return {
    async getUserByUsername(username) {
      const rows = await db
        .select({ username: user.username, name: user.name, image: user.image })
        .from(user)
        .where(eq(user.username, username))
        .limit(1)

      const row = rows[0]
      if (!row?.username) return null
      return { username: row.username, name: row.name, image: row.image ?? null }
    },

    async setAvatar(userId, image) {
      await db.update(user).set({ image }).where(eq(user.id, userId))
    },
  }
}
