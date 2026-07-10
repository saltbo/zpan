import type {
  AdminDashboardGrowthStats,
  AdminDashboardOperationsStats,
  AdminDashboardOverviewStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
} from '@shared/types'

export interface AdminStatsRepo {
  refreshHourlyRollups(
    now: Date,
  ): Promise<Array<{ bucketStart: Date; bucketEnd: Date; rows: number; lowerBoundRows: number }>>
  getDashboardOverviewStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardOverviewStats>
  getDashboardOperationsStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardOperationsStats>
  getDashboardGrowthStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardGrowthStats>
  getDashboardStorageStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardStorageStats>
  getDashboardTrafficStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardTrafficStats>
  getDashboardSharingStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardSharingStats>
}

export interface AdminStatsDateRange {
  from: Date
  to: Date
  timeZone: string
}
