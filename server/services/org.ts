import { and, eq, like } from 'drizzle-orm'
import { member, organization } from '../db/auth-schema'
import type { Database } from '../platform/interface'

export async function findPersonalOrg(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), like(organization.metadata, '%"type":"personal"%')))
    .limit(1)

  return rows[0]?.orgId ?? null
}
