import type {
  StorageUsageBreakdown,
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageSortDirection,
  StorageUsageSortField,
} from '@shared/types'

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
    sortBy: StorageUsageSortField,
    sortDir: StorageUsageSortDirection,
  ): Promise<{ items: StorageUsageItem[]; total: number }>
}
