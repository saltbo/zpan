import { isPersonalOrgLike } from '@shared/org-slugs'
import { and, eq } from 'drizzle-orm'
import { member, organization } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { OrgRepo } from '../../usecases/ports'

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

export function createOrgRepo(db: Database): OrgRepo {
  // Find the user's personal org, if they still belong to it. New personal orgs
  // are identified by metadata.type; legacy rows keep the `personal-*` slug.
  // The member row remains load-bearing because admins can revoke access without
  // deleting the org.
  async function findPersonalOrg(userId: string): Promise<string | null> {
    const rows = await db
      .select({ orgId: organization.id, slug: organization.slug, metadata: organization.metadata })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
    return rows.find(isPersonalOrgLike)?.orgId ?? null
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
      .select({ slug: organization.slug, metadata: organization.metadata })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1)
    return rows[0] ? isPersonalOrgLike(rows[0]) : false
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
