import { and, count, eq, inArray, like, not } from 'drizzle-orm'
import { member, organization, user } from '../db/auth-schema'
import type { Database } from '../platform/interface'
import { getEffectiveQuota, getEffectiveQuotasByOrg } from './effective-quota'

export interface TeamSummary {
  id: string
  name: string
  slug: string
  logo: string | null
  memberCount: number
  ownerName: string | null
  quotaUsed: number
  quotaTotal: number
  createdAt: number
}

// Personal orgs use the deterministic `personal-${userId}` slug; everything
// else is a team. Production teams may have null metadata, so the slug prefix
// is the reliable discriminator (not metadata.type).
const isTeamSlug = not(like(organization.slug, 'personal-%'))

export async function listTeams(db: Database): Promise<TeamSummary[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(isTeamSlug)
    .orderBy(organization.name)

  if (rows.length === 0) return []

  const orgIds = rows.map((r) => r.id)
  const quotas = await getEffectiveQuotasByOrg(db, orgIds)

  const memberRows = await db
    .select({ orgId: member.organizationId, total: count() })
    .from(member)
    .where(inArray(member.organizationId, orgIds))
    .groupBy(member.organizationId)
  const memberByOrg = new Map(memberRows.map((r) => [r.orgId, r.total]))

  const owners = await listOwnerNames(db, orgIds)

  return rows.map((r) => {
    const quota = quotas.get(r.id)
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo,
      memberCount: memberByOrg.get(r.id) ?? 0,
      ownerName: owners.get(r.id) ?? null,
      quotaUsed: quota?.used ?? 0,
      quotaTotal: quota?.quota ?? 0,
      createdAt: r.createdAt.getTime(),
    }
  })
}

export async function getTeam(db: Database, orgId: string): Promise<TeamSummary | null> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(and(eq(organization.id, orgId), isTeamSlug))
    .limit(1)
  const org = rows[0]
  if (!org) return null

  const quota = await getEffectiveQuota(db, orgId)
  const [memberRow] = await db.select({ total: count() }).from(member).where(eq(member.organizationId, orgId))
  const owners = await listOwnerNames(db, [orgId])

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo,
    memberCount: memberRow?.total ?? 0,
    ownerName: owners.get(orgId) ?? null,
    quotaUsed: quota.used,
    quotaTotal: quota.quota,
    createdAt: org.createdAt.getTime(),
  }
}

// First owner per org (by member creation order), for a display label.
async function listOwnerNames(db: Database, orgIds: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({
      orgId: member.organizationId,
      name: user.name,
      email: user.email,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.role, 'owner'), inArray(member.organizationId, orgIds)))
    .orderBy(member.createdAt)

  const byOrg = new Map<string, string>()
  for (const r of rows) {
    if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, r.name || r.email)
  }
  return byOrg
}
