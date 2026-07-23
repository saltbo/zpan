import type {
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageResponse,
  StorageUsageSortDirection,
  StorageUsageSortField,
} from '@shared/types'
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

export async function listStorageUsageItems(
  deps: Pick<Deps, 'storageUsageBreakdowns'>,
  orgId: string,
  input: {
    category: StorageUsageCategory
    page: number
    pageSize: number
    sortBy: StorageUsageSortField
    sortDir: StorageUsageSortDirection
  },
): Promise<{ items: StorageUsageItem[]; total: number }> {
  return deps.storageUsageBreakdowns.listItems(
    orgId,
    input.category,
    input.page,
    input.pageSize,
    input.sortBy,
    input.sortDir,
  )
}
