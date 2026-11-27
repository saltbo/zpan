// Workspace member roles by what they may do: an owner or admin manages the
// workspace, an editor changes its content, and a viewer (or a plain member)
// reads it. The server's route policies and the web's controls share this order.
const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  admin: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

export type TeamRole = 'viewer' | 'editor' | 'owner'

// Whether a member's role reaches the role a route requires.
export function teamRoleAtLeast(role: string | null | undefined, min: TeamRole): boolean {
  return (ROLE_LEVELS[role ?? ''] ?? 0) >= ROLE_LEVELS[min]
}
