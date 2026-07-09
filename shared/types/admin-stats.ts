export interface AdminCoreStats {
  generatedAt: string
  users: {
    total: number
    admins: number
    activeLast30Days: number
    newLast7Days: number
  }
  spaces: {
    total: number
    personal: number
    team: number
    newLast30Days: number
  }
  storage: {
    usedBytes: number
    quotaBytes: number
    quotaUtilization: number
    capacityBytes: number
    backendCount: number
    activeBackendCount: number
  }
  traffic: {
    usedBytes: number
    quotaBytes: number
    utilization: number
    period: string
  }
  sharing: {
    totalShares: number
    activeShares: number
    views: number
    downloads: number
  }
  operations: {
    pendingInvitations: number
    failedBackgroundJobs: number
    offlineDownloaders: number
    runningDownloadTasks: number
  }
}

export interface AdminStatsPoint {
  date: string
  signups: number
  activeUsers: number
  shareViews: number
  shareDownloads: number
  remoteTasks: number
  failedJobs: number
}

export interface AdminUsageBySpace {
  orgId: string
  orgName: string
  orgType: string
  usedBytes: number
  quotaBytes: number
  utilization: number
}

export interface AdminStorageByType {
  type: string
  bytes: number
  files: number
}

export interface AdminTopShare {
  id: string
  token: string
  name: string
  creatorId: string
  creatorName: string
  views: number
  downloads: number
  status: string
}

export interface AdminCountByStatus {
  status: string
  count: number
}

export interface AdminDownloadFailureReason {
  reason: string
  count: number
}

export interface AdminDownloaderHealth {
  downloaderId: string
  name: string
  status: string
  tasks: number
  failedTasks: number
  lastHeartbeatAt: string | null
}

export interface AdminBackgroundJobFailure {
  id: string
  type: string
  errorMessage: string | null
  createdAt: string
}

export interface AdminDetailedStats {
  generatedAt: string
  periodDays: number
  trends: AdminStatsPoint[]
  usageBySpace: AdminUsageBySpace[]
  storageByType: AdminStorageByType[]
  topShares: AdminTopShare[]
  sharing: {
    expiredShares: number
    revokedShares: number
    downloadLimitHitShares: number
    conversionRate: number
  }
  remoteDownloads: {
    total: number
    completed: number
    failed: number
    running: number
    successRate: number
    byStatus: AdminCountByStatus[]
    failureReasons: AdminDownloadFailureReason[]
    byDownloader: AdminDownloaderHealth[]
  }
  reliability: {
    backgroundJobs: {
      total: number
      failed: number
      failureRate: number
      byStatus: AdminCountByStatus[]
      failures: AdminBackgroundJobFailure[]
    }
    cloudTrafficReports: {
      pending: number
      failed: number
    }
    license: {
      active: boolean
      edition: string | null
      lastRefreshAt: string | null
      lastRefreshError: string | null
    }
  }
}

export interface AdminStatsRange {
  generatedAt: string
  from: string
  to: string
}

export interface AdminStatsDelta {
  value: number
  previousValue: number
  changePercent: number
}

export interface AdminDashboardOverviewStats extends AdminStatsRange {
  totals: {
    users: number
    newUsers: AdminStatsDelta
    activeUsers: AdminStatsDelta
    storageUsedBytes: number
    storageQuotaBytes: number
    trafficBytes: AdminStatsDelta
    uploadBytes: AdminStatsDelta
    downloadBytes: AdminStatsDelta
    activeShares: number
    shareViews: AdminStatsDelta
    shareDownloads: AdminStatsDelta
  }
  trends: Array<{
    date: string
    newUsers: number
    activeUsers: number
    storageUsedBytes: number
    uploadBytes: number
    downloadBytes: number
  }>
}

export interface AdminDashboardGrowthStats extends AdminStatsRange {
  summary: {
    totalUsers: number
    newUsers: AdminStatsDelta
    activeUsers: AdminStatsDelta
    verifiedUsers: number
    bannedUsers: number
    silentUsers: number
  }
  userScaleTrend: Array<{ date: string; newUsers: number; totalUsers: number }>
  activeUserTrend: Array<{ date: string; dau: number; wau: number; mau: number }>
  userStatus: Array<{ name: string; value: number; percent: number }>
  registrationSources: Array<{ name: string; value: number; percent: number }>
}

export interface AdminDashboardStorageStats extends AdminStatsRange {
  summary: {
    storageUsedBytes: number
    quotaBytes: number
    fileCount: number
    newFiles: AdminStatsDelta
    newBytes: AdminStatsDelta
    coldFileBytes: number
  }
  storageTrend: Array<{ date: string; usedBytes: number; newBytes: number; newFiles: number }>
  typeBreakdown: Array<{ type: string; bytes: number; files: number; percent: number }>
  sizeBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
  ageBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
}

export interface AdminDashboardTrafficStats extends AdminStatsRange {
  summary: {
    totalBytes: AdminStatsDelta
    requestCount: AdminStatsDelta
    issuedDownloads: number
    blockedDownloads: number
    issueRate: number
    peakDailyBytes: number
  }
  trafficTrend: Array<{ date: string; uploadBytes: number; downloadBytes: number; requests: number }>
  sourceBreakdown: Array<{ name: string; bytes: number; requests: number; percent: number }>
  issueStatus: Array<{ status: string; count: number; percent: number }>
  bandwidthTrend: Array<{ date: string; bytes: number }>
}

export interface AdminDashboardSharingStats extends AdminStatsRange {
  summary: {
    activeShares: number
    createdShares: AdminStatsDelta
    views: AdminStatsDelta
    downloads: AdminStatsDelta
    saves: AdminStatsDelta
    downloadConversionRate: number
  }
  funnel: Array<{ name: string; value: number; percent: number }>
  trend: Array<{ date: string; views: number; downloads: number; saves: number }>
  typeBreakdown: Array<{ name: string; value: number; percent: number }>
  sourceBreakdown: Array<{ name: string; value: number; percent: number }>
  topShares: Array<AdminTopShare & { viewPercent: number; downloadPercent: number }>
}

export interface AdminDashboardRankingStats extends AdminStatsRange {
  topShares: Array<AdminTopShare & { viewPercent: number; downloadPercent: number }>
  topSpaces: AdminUsageBySpace[]
  storageByType: AdminStorageByType[]
}
