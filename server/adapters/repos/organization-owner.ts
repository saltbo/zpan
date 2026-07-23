import { and, asc, eq } from 'drizzle-orm'
import { member } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'

export async function resolveOrganizationOwnerUserId(db: Database, orgId: string): Promise<string> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.role, 'owner')))
    .orderBy(asc(member.createdAt))
    .limit(1)
  const ownerUserId = rows[0]?.userId
  if (!ownerUserId) throw new Error(`Organization has no owner: ${orgId}`)
  return ownerUserId
}
