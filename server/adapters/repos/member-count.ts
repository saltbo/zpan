import { eq } from 'drizzle-orm'
import { member } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { MemberCountRepo } from '../../usecases/ports'

export function createMemberCountRepo(db: Database): MemberCountRepo {
  return {
    async countUserOrgs(userId) {
      const rows = await db.select({ id: member.id }).from(member).where(eq(member.userId, userId))
      return rows.length
    },
  }
}
