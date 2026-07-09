import type {
  AdminBackgroundJobFailure,
  AdminCoreStats,
  AdminCountByStatus,
  AdminDashboardGrowthStats,
  AdminDashboardOverviewStats,
  AdminDashboardRankingStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
  AdminDetailedStats,
  AdminDownloaderHealth,
  AdminDownloadFailureReason,
  AdminStatsPoint,
  AdminStorageByType,
  AdminTopShare,
} from '@shared/types'

export interface AdminCoreStatsBase {
  users: AdminCoreStats['users']
  spaces: AdminCoreStats['spaces']
  storageBackends: Pick<AdminCoreStats['storage'], 'capacityBytes' | 'backendCount' | 'activeBackendCount'>
  sharing: AdminCoreStats['sharing']
  operations: AdminCoreStats['operations']
}

export interface AdminDetailedStatsBase {
  trends: AdminStatsPoint[]
  storageByType: AdminStorageByType[]
  topShares: AdminTopShare[]
  sharing: AdminDetailedStats['sharing']
  remoteDownloads: Omit<AdminDetailedStats['remoteDownloads'], 'successRate'> & {
    failureReasons: AdminDownloadFailureReason[]
    byDownloader: AdminDownloaderHealth[]
  }
  backgroundJobs: {
    total: number
    failed: number
    byStatus: AdminCountByStatus[]
    failures: AdminBackgroundJobFailure[]
  }
  cloudTrafficReports: AdminDetailedStats['reliability']['cloudTrafficReports']
}

export interface AdminStatsRepo {
  getCoreStatsBase(now: Date): Promise<AdminCoreStatsBase>
  getDetailedStatsBase(now: Date, periodDays: number): Promise<AdminDetailedStatsBase>
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
