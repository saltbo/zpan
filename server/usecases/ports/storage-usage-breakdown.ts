import type {
  StorageUsageBreakdown,
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageSortDirection,
  StorageUsageSortField,
} from '@shared/types'

// The sort column's value (name, size, or updated-at ms) and the row id that breaks ties.
export type StorageUsageItemBoundary = { value: string | number; id: string }

export interface StorageUsageProjection {
  updatedAt: Date | null
  breakdowns: StorageUsageBreakdown[]
}

export interface StorageUsageBreakdownRepo {
  get(orgId: string): Promise<StorageUsageProjection>
  listItems(
    orgId: string,
    opts: {
      category: StorageUsageCategory
      pageSize: number
      sortBy: StorageUsageSortField
      sortDir: StorageUsageSortDirection
      after?: StorageUsageItemBoundary
    },
  ): Promise<{ items: StorageUsageItem[]; nextBoundary: StorageUsageItemBoundary | null }>
}
