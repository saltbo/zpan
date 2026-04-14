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
