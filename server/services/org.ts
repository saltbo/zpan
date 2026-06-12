import { and, eq } from 'drizzle-orm'
import { member, organization } from '../db/auth-schema'
import type { Database } from '../platform/interface'

// Find the user's personal org, if they still belong to it. The personal org
// slug is a deterministic `personal-${user.id}` written by createAuth's
// user.create.after hook, so we filter on the indexed UNIQUE slug column and
// then verify the member row still exists. Verifying membership is load-
// bearing: an admin can revoke a user's access by deleting the member row
// without deleting the org, and the caller must treat that user as orphaned.
export async function findPersonalOrg(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ orgId: organization.id })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
    .where(eq(organization.slug, `personal-${userId}`))
    .limit(1)

  return rows[0]?.orgId ?? null
}

// Return the user's role in the given org, or null if they are not a member.
export async function getMemberRole(db: Database, orgId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)

  return rows[0]?.role ?? null
}

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

// Whether the user may read content of the given org: any membership role, or
// the org is the user's own personal org. Never grants access to another
// user's personal org.
export async function canReadOrg(db: Database, userId: string, orgId: string): Promise<boolean> {
  const role = await getMemberRole(db, orgId, userId)
  if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.viewer
  return orgId === (await findPersonalOrg(db, userId))
}

// Whether the user may write content into the given org: editor or owner
// membership, or the org is the user's own personal org. Checking ownership
// via findPersonalOrg (not isPersonalOrg) is load-bearing: a request-supplied
// orgId must never write into another user's personal space.
export async function canWriteToOrg(db: Database, userId: string, orgId: string): Promise<boolean> {
  const role = await getMemberRole(db, orgId, userId)
  if (role !== null) return (ROLE_LEVELS[role] ?? 0) >= ROLE_LEVELS.editor
  return orgId === (await findPersonalOrg(db, userId))
}

// Whether the user owns the given org: owner membership role, or the org is
// the user's own personal org.
export async function isOrgOwner(db: Database, userId: string, orgId: string): Promise<boolean> {
  const role = await getMemberRole(db, orgId, userId)
  if (role !== null) return role === 'owner'
  return orgId === (await findPersonalOrg(db, userId))
}

// Personal orgs use a deterministic slug `personal-${userId}`. Checking the
// slug is sufficient — no additional query is needed.
export async function isPersonalOrg(db: Database, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1)

  return (rows[0]?.slug ?? '').startsWith('personal-')
}
