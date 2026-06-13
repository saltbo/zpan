import { FREE_TEAM_LIMIT } from '@shared/constants'
import { hasFeature } from '../domain/licensing'
import { loadBindingState } from './licensing'
import type { LicenseBindingRepo, MemberCountRepo } from './ports'

export type TeamCountDeps = { memberCount: MemberCountRepo; licenseBinding: LicenseBindingRepo }

export async function checkTeamLimit(
  deps: TeamCountDeps,
  userId: string,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const [count, state] = await Promise.all([
    deps.memberCount.countUserOrgs(userId),
    loadBindingState({ licenseBinding: deps.licenseBinding }),
  ])
  const unlimited = hasFeature('teams_unlimited', state)
  return { allowed: unlimited || count < FREE_TEAM_LIMIT, count, limit: FREE_TEAM_LIMIT }
}
