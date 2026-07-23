import type { StorageUsageBreakdown, StorageUsageCategory, StorageUsageItem } from '@shared/types'

export interface StorageUsageProjection {
  updatedAt: Date | null
  breakdowns: StorageUsageBreakdown[]
}

export interface StorageUsageBreakdownRepo {
  get(orgId: string): Promise<StorageUsageProjection>
  listItems(
    orgId: string,
    category: StorageUsageCategory,
    page: number,
    pageSize: number,
  ): Promise<{ items: StorageUsageItem[]; total: number }>
}
