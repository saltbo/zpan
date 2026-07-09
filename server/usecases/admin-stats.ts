import type { AdminCoreStats, AdminDetailedStats, AdminUsageBySpace } from '@shared/types'
import { currentTrafficPeriod } from '../domain/quota'
import { percent } from './admin-stats-utils'
import type { AdminStatsRepo, LicenseBindingRepo, QuotaRepo } from './ports'
import { listQuotaOverview } from './quota'
import { loadBindingState } from './site/licensing'

export type AdminStatsDeps = {
  adminStats: AdminStatsRepo
  quota: Pick<QuotaRepo, 'listOrgQuotaOverview' | 'getEffectiveQuotasByOrg'>
  licenseBinding: LicenseBindingRepo
}

export async function getAdminCoreStats(deps: AdminStatsDeps, now = new Date()): Promise<AdminCoreStats> {
  const [base, quotas] = await Promise.all([deps.adminStats.getCoreStatsBase(now), listQuotaOverview(deps, now)])
  const quotaItems = quotas.items
  const usedBytes = quotaItems.reduce((sum, item) => sum + item.used, 0)
  const quotaBytes = quotaItems.reduce((sum, item) => sum + item.quota, 0)
  const trafficUsedBytes = quotaItems.reduce((sum, item) => sum + item.trafficUsed, 0)
  const trafficQuotaBytes = quotaItems.reduce((sum, item) => sum + item.trafficQuota, 0)

  return {
    generatedAt: now.toISOString(),
    users: base.users,
    spaces: base.spaces,
    storage: {
      usedBytes,
      quotaBytes,
      quotaUtilization: percent(usedBytes, quotaBytes),
      capacityBytes: base.storageBackends.capacityBytes,
      backendCount: base.storageBackends.backendCount,
      activeBackendCount: base.storageBackends.activeBackendCount,
    },
    traffic: {
      usedBytes: trafficUsedBytes,
      quotaBytes: trafficQuotaBytes,
      utilization: percent(trafficUsedBytes, trafficQuotaBytes),
      period: quotaItems[0]?.trafficPeriod ?? currentTrafficPeriod(now),
    },
    sharing: base.sharing,
    operations: base.operations,
  }
}

export async function getAdminDetailedStats(
  deps: AdminStatsDeps,
  params: { periodDays: number },
  now = new Date(),
): Promise<AdminDetailedStats> {
  const periodDays = normalizePeriodDays(params.periodDays)
  const [base, quotas, license] = await Promise.all([
    deps.adminStats.getDetailedStatsBase(now, periodDays),
    listQuotaOverview(deps, now),
    loadBindingState(deps),
  ])
  const usageBySpace = quotas.items
    .map<AdminUsageBySpace>((item) => ({
      orgId: item.orgId,
      orgName: item.orgName,
      orgType: item.orgType,
      usedBytes: item.used,
      quotaBytes: item.quota,
      utilization: percent(item.used, item.quota),
    }))
    .sort((a, b) => b.utilization - a.utilization || b.usedBytes - a.usedBytes)
    .slice(0, 8)

  return {
    generatedAt: now.toISOString(),
    periodDays,
    trends: base.trends,
    usageBySpace,
    storageByType: base.storageByType,
    topShares: base.topShares,
    sharing: base.sharing,
    remoteDownloads: {
      ...base.remoteDownloads,
      successRate: percent(base.remoteDownloads.completed, base.remoteDownloads.total),
    },
    reliability: {
      backgroundJobs: {
        ...base.backgroundJobs,
        failureRate: percent(base.backgroundJobs.failed, base.backgroundJobs.total),
      },
      cloudTrafficReports: base.cloudTrafficReports,
      license: {
        active: Boolean(license.active),
        edition: license.edition ?? null,
        lastRefreshAt: license.last_refresh_at ? new Date(license.last_refresh_at * 1000).toISOString() : null,
        lastRefreshError: license.last_refresh_error ?? null,
      },
    },
  }
}

function normalizePeriodDays(value: number): number {
  if (value <= 7) return 7
  if (value <= 30) return 30
  return 90
}
