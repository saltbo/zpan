import { and, eq } from 'drizzle-orm'
import { member, organization } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { OrgRepo } from '../../usecases/ports'

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

export function createOrgRepo(db: Database): OrgRepo {
  // Find the user's personal org, if they still belong to it. The personal org
  // slug is a deterministic `personal-${user.id}`; filter on the indexed UNIQUE
  // slug then verify the member row still exists (an admin can revoke access by
  // deleting the member row without deleting the org).
  async function findPersonalOrg(userId: string): Promise<string | null> {
    const rows = await db
      .select({ orgId: organization.id })
      .from(organization)
      .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
      .where(eq(organization.slug, `personal-${userId}`))
      .limit(1)
    return rows[0]?.orgId ?? null
  }

  async function getMemberRole(orgId: string, userId: string): Promise<string | null> {
    const rows = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
    return rows[0]?.role ?? null
  }

  async function isPersonalOrg(orgId: string): Promise<boolean> {
    const rows = await db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    return (rows[0]?.slug ?? '').startsWith('personal-')
  }

  // Read access: any membership role, or the user's own personal org. Never
  // grants access to another user's personal org.
  async function canReadOrg(userId: string, orgId: string): Promise<boolean> {
    const role = await getMemberRole(orgId, userId)
    if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.viewer
    return orgId === (await findPersonalOrg(userId))
  }

  // Write access: editor/owner membership, or the user's own personal org.
  // Checking ownership via findPersonalOrg (not isPersonalOrg) is load-bearing:
  // a request-supplied orgId must never write into another user's personal space.
  async function canWriteToOrg(userId: string, orgId: string): Promise<boolean> {
    const role = await getMemberRole(orgId, userId)
    if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.editor
    return orgId === (await findPersonalOrg(userId))
  }

  return { findPersonalOrg, getMemberRole, canReadOrg, canWriteToOrg, isPersonalOrg }
}
