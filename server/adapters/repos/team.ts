import { isTeamOrgLike, LEGACY_PERSONAL_ORG_SLUG_PREFIX } from '@shared/org-slugs'
import { and, count, desc, eq, inArray, notLike, sql } from 'drizzle-orm'
import { member, organization, user } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import type { TeamRepo, TeamSummary } from '../../usecases/ports'
import { afterCreatedAtId, keysetPage } from './keyset'
import { createQuotaRepo } from './quota'

// SQL form of isTeamOrgLike, so personal orgs never take a slot in a team page.
function teamOrgCondition() {
  const metadataType = sql`CASE WHEN json_valid(${organization.metadata}) THEN json_extract(${organization.metadata}, '$.type') END`
  return and(
    notLike(organization.slug, `${LEGACY_PERSONAL_ORG_SLUG_PREFIX}%`),
    sql`(${metadataType} IS NULL OR ${metadataType} <> 'personal')`,
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

// First owner per org (by member creation order), for a display label.
async function listOwnerNames(db: Database, orgIds: string[]): Promise<Map<string, string>> {
  // D1 caps a query at 100 bound params; chunk the IN list (plus the role param).
  const chunks = await Promise.all(
    chunk(orgIds, 90).map((ids) =>
      db
        .select({
          orgId: member.organizationId,
          name: user.name,
          email: user.email,
          createdAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.role, 'owner'), inArray(member.organizationId, ids)))
        .orderBy(member.createdAt),
    ),
  )

  const byOrg = new Map<string, string>()
  for (const r of chunks.flat()) {
    if (!byOrg.has(r.orgId)) byOrg.set(r.orgId, r.name || r.email)
  }
  return byOrg
}

export function createTeamRepo(db: Database): TeamRepo {
  const quota = createQuotaRepo(db)

  return {
    async listTeams({ pageSize, after }) {
      const found = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(and(teamOrgCondition(), afterCreatedAtId(organization.createdAt, organization.id, after)))
        .orderBy(desc(organization.createdAt), desc(organization.id))
        .limit(pageSize + 1)
      const { rows: teamRows, next } = keysetPage(found, pageSize, (row) => ({ createdAt: row.createdAt, id: row.id }))

      if (teamRows.length === 0) return { items: [], nextBoundary: null }

      const orgIds = teamRows.map((r) => r.id)
      const quotas = await quota.getEffectiveQuotasByOrg(orgIds)

      // D1 caps a query at 100 bound params; chunk the IN lists below the cap.
      const memberChunks = await Promise.all(
        chunk(orgIds, 90).map((ids) =>
          db
            .select({ orgId: member.organizationId, total: count() })
            .from(member)
            .where(inArray(member.organizationId, ids))
            .groupBy(member.organizationId),
        ),
      )
      const memberByOrg = new Map(memberChunks.flat().map((r) => [r.orgId, r.total]))
      const owners = await listOwnerNames(db, orgIds)

      const items = teamRows.map((r) => {
        const q = quotas.get(r.id)
        return {
          id: r.id,
          name: r.name,
          slug: r.slug,
          logo: r.logo,
          memberCount: memberByOrg.get(r.id) ?? 0,
          ownerName: owners.get(r.id) ?? null,
          quotaUsed: q?.used ?? 0,
          quotaTotal: q?.quota ?? 0,
          createdAt: r.createdAt.getTime(),
        } satisfies TeamSummary
      })
      return { items, nextBoundary: next }
    },

    async getTeam(orgId) {
      const rows = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          metadata: organization.metadata,
          logo: organization.logo,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
      const org = rows[0]
      if (!org || !isTeamOrgLike(org)) return null

      const q = await quota.getEffectiveQuota(orgId)
      const [memberRow] = await db.select({ total: count() }).from(member).where(eq(member.organizationId, orgId))
      const owners = await listOwnerNames(db, [orgId])

      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo,
        memberCount: memberRow?.total ?? 0,
        ownerName: owners.get(orgId) ?? null,
        quotaUsed: q.used,
        quotaTotal: q.quota,
        createdAt: org.createdAt.getTime(),
      } satisfies TeamSummary
    },

    async setLogo(orgId, logo) {
      await db.update(organization).set({ logo }).where(eq(organization.id, orgId))
    },
  }
}
