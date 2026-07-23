import type { StorageUsageResponse } from '@shared/types'
import type { Deps } from './deps'

export async function getStorageUsage(
  deps: Pick<Deps, 'quota' | 'storageUsageBreakdowns'>,
  orgId: string,
): Promise<StorageUsageResponse> {
  const [projection, quota] = await Promise.all([
    deps.storageUsageBreakdowns.get(orgId),
    deps.quota.getEffectiveQuota(orgId),
  ])
  return {
    usedBytes: quota.used,
    quotaBytes: quota.quota,
    currentPlan: quota.currentPlan
      ? {
          name: quota.currentPlan.name,
          storageBytes: quota.currentPlan.storageBytes,
          subscription: quota.currentPlan.subscription,
        }
      : null,
    breakdowns: projection.breakdowns,
    updatedAt: projection.updatedAt?.toISOString() ?? null,
  }
}
