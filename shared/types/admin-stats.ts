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
