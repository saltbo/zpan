import { eq } from 'drizzle-orm'
import { COMMUNITY_TEAM_LIMIT } from '../../shared/constants'
import { member } from '../db/auth-schema'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import type { Database } from '../platform/interface'

export async function countUserOrgs(db: Database, userId: string): Promise<number> {
  const rows = await db.select({ id: member.id }).from(member).where(eq(member.userId, userId))
  return rows.length
}

export async function checkTeamLimit(
  db: Database,
  userId: string,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const [count, state] = await Promise.all([countUserOrgs(db, userId), loadBindingState(db)])
  const unlimited = hasFeature('teams_unlimited', state)
  return { allowed: unlimited || count < COMMUNITY_TEAM_LIMIT, count, limit: COMMUNITY_TEAM_LIMIT }
}
