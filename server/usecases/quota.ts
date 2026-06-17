// The quotas resource usecase (/api/admin/quotas, /api/quotas). Owns the admin
// overview assembly (join overview rows with effective quotas + org type) and
// the per-user effective-quota lookup with personal-org fallback.

import type { EffectiveQuota, OrgRepo, QuotaRepo } from './ports'

export type QuotaOverviewItem = { id: string } & EffectiveQuota & { orgName: string; orgType: string }

export async function listQuotaOverview(
  deps: { quota: Pick<QuotaRepo, 'listOrgQuotaOverview' | 'getEffectiveQuotasByOrg'> },
  now: Date = new Date(),
): Promise<{ items: QuotaOverviewItem[]; total: number }> {
  const rows = await deps.quota.listOrgQuotaOverview()
  const quotas = await deps.quota.getEffectiveQuotasByOrg(
    rows.map((r) => r.orgId),
    now,
  )
  const items = rows.map((r) => ({
    id: r.id,
    ...quotas.get(r.orgId)!,
    orgName: r.orgName,
    orgType: parseOrgType(r.orgMetadata),
  }))
  return { items, total: items.length }
}

export async function getUserQuota(
  deps: { quota: Pick<QuotaRepo, 'getEffectiveQuota'>; org: Pick<OrgRepo, 'findPersonalOrg'> },
  params: { userId: string; orgId?: string },
): Promise<EffectiveQuota | null> {
  const orgId = params.orgId ?? (await deps.org.findPersonalOrg(params.userId))
  if (!orgId) return null
  return deps.quota.getEffectiveQuota(orgId)
}

export type UserQuotaItem = { userId: string; used: number; total: number }

// Batch effective storage quota for an admin user listing. Admin user identity
// comes from better-auth's /admin/list-users; this fills in the per-user storage
// "used / total" that better-auth doesn't know about. The caller is page-bounded
// (one page of ids at a time), so the personal-org IN-list stays well under D1's
// bound-parameter cap. Users without a personal org are simply omitted.
export async function getUsersQuota(
  deps: { quota: Pick<QuotaRepo, 'getEffectiveQuotasByOrg'>; org: Pick<OrgRepo, 'findPersonalOrg'> },
  userIds: string[],
  now: Date = new Date(),
): Promise<UserQuotaItem[]> {
  const pairs = await Promise.all(
    userIds.map(async (userId) => ({ userId, orgId: await deps.org.findPersonalOrg(userId) })),
  )
  const orgToUser = new Map<string, string>()
  for (const { userId, orgId } of pairs) {
    if (orgId) orgToUser.set(orgId, userId)
  }
  const quotas = await deps.quota.getEffectiveQuotasByOrg([...orgToUser.keys()], now)
  const items: UserQuotaItem[] = []
  for (const [orgId, quota] of quotas) {
    const userId = orgToUser.get(orgId)
    if (!userId) continue
    items.push({ userId, used: quota.used, total: quota.quota })
  }
  return items
}

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  try {
    return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
