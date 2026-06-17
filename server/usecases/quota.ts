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

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  try {
    return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
