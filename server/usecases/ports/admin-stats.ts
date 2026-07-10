import type {
  AdminDashboardGrowthStats,
  AdminDashboardOverviewStats,
  AdminDashboardRankingStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
} from '@shared/types'

export interface AdminStatsRepo {
  getDashboardOverviewStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardOverviewStats>
  getDashboardGrowthStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardGrowthStats>
  getDashboardStorageStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardStorageStats>
  getDashboardTrafficStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardTrafficStats>
  getDashboardSharingStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardSharingStats>
  getDashboardRankingStats(now: Date, range: AdminStatsDateRange): Promise<AdminDashboardRankingStats>
}

export interface AdminStatsDateRange {
  from: Date
  to: Date
}
