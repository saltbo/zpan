import { type TeamRole, teamRoleAtLeast } from '@shared/team-roles'
import { useActiveOrganization, useSession } from '@/lib/auth-client'

// Whether the signed-in user's role in the active workspace reaches `min`, the
// role the server requires for the action. False until the membership loads,
// so a control the user cannot use never flashes.
export function useWorkspaceRoleAtLeast(min: TeamRole): boolean {
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const userId = session?.user?.id
  const member = activeOrg?.members?.find((item: { userId: string; role: string }) => item.userId === userId)
  return teamRoleAtLeast(member?.role, min)
}
