export interface AdminUsageBySpace {
  orgId: string
  orgName: string
  orgType: string
  usedBytes: number
  quotaBytes: number
  utilization: number | null
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

export interface AdminStatsRange {
  generatedAt: string
  from: string
  to: string
  timeZone: 'UTC'
  coverage: AdminStatsCoverage
  comparisonCoverage?: AdminStatsCoverage
  snapshotCoverage?: AdminStatsCoverage
  comparisonSnapshotCoverage?: AdminStatsCoverage
}

export interface AdminStatsCoverage {
  status: 'complete' | 'partial' | 'empty'
  expectedBuckets: number
  completedBuckets: number
  lowerBoundBuckets: number
  quality: 'exact' | 'lower_bound'
  dataThrough: string | null
}

export interface AdminStatsDelta {
  value: number | null
  previousValue: number | null
  change: number | null
  changePercent: number | null
}

export interface AdminTransferDataQuality {
  missingUploadBytesEvents: number
  previousMissingUploadBytesEvents: number
  missingDownloadBytesEvents: number
  previousMissingDownloadBytesEvents: number
  missingBytesEvents: number
  previousMissingBytesEvents: number
}

export interface AdminSharingDataQuality {
  unlocatedViews: number | null
  unlocatedDownloads: number | null
  unlocatedEvents: number | null
}

export interface AdminStorageDataQuality extends AdminTransferDataQuality {
  usageDriftSpaces: number | null
  usageDriftBytes: number | null
  ledgerDriftSpaces: number | null
  ledgerDriftBytes: number | null
}

export interface AdminDashboardOverviewStats extends AdminStatsRange {
  dataQuality: AdminTransferDataQuality
  totals: {
    users: number | null
    newUsers: AdminStatsDelta
    activeUsers: AdminStatsDelta
    activeUserRate: number | null
    storageUsedBytes: number | null
    storageQuotaBytes: number | null
    storageUtilization: number | null
    trafficBytes: AdminStatsDelta
    uploadBytes: AdminStatsDelta
    downloadBytes: AdminStatsDelta
    activeShares: number | null
    shareViews: AdminStatsDelta
    shareDownloads: AdminStatsDelta
  }
  trends: Array<{
    date: string
    newUsers: number
    activeUsers: number | null
    storageUsedBytes: number | null
    uploadBytes: number
    downloadBytes: number
  }>
}

export interface AdminDashboardGrowthStats extends AdminStatsRange {
  summary: {
    totalUsers: number | null
    newUsers: AdminStatsDelta
    activeUsers: AdminStatsDelta
    verifiedUsers: number | null
    bannedUsers: number | null
    silentUsers: number | null
    activeUserRate: number | null
    silentUserRate: number | null
  }
  userScaleTrend: Array<{ date: string; newUsers: number; totalUsers: number | null }>
  activeUserTrend: Array<{ date: string; dau: number | null; wau: number | null; mau: number | null }>
  userStatus: Array<{ name: string; value: number; percent: number }>
  registrationSources: Array<{ name: string; value: number; percent: number }>
}

export interface AdminDashboardStorageStats extends AdminStatsRange {
  dataQuality: AdminStorageDataQuality
  summary: {
    storageUsedBytes: number | null
    quotaBytes: number | null
    fileCount: number | null
    trashFileCount: number | null
    trashBytes: number | null
    newFiles: AdminStatsDelta
    newBytes: AdminStatsDelta
    coldFileBytes: number | null
    storageUtilization: number | null
    coldFilePercent: number | null
    nearQuotaSpaces: number | null
    overQuotaSpaces: number | null
    invalidQuotaSpaces: number | null
  }
  storageTrend: Array<{ date: string; usedBytes: number | null; newBytes: number; newFiles: number }>
  typeBreakdown: Array<{ type: string; bytes: number; files: number; percent: number }>
  sizeBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
  ageBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
  topSpaces: AdminUsageBySpace[]
}

export interface AdminDashboardTrafficStats extends AdminStatsRange {
  dataQuality: AdminTransferDataQuality
  summary: {
    totalBytes: AdminStatsDelta
    requestCount: AdminStatsDelta
    issuedDownloads: number
    blockedDownloads: number
    downloadIssueSuccessRate: number | null
    peakDailyBytes: number
  }
  trafficTrend: Array<{ date: string; uploadBytes: number; downloadBytes: number; requests: number }>
  sourceBreakdown: Array<{ name: string; bytes: number; requests: number; percent: number }>
  issueStatus: Array<{ status: string; count: number; percent: number }>
  successTrend: Array<{ date: string; uploadSuccessRate: number | null; downloadSuccessRate: number | null }>
  failureReasons: Array<{ name: string; value: number; percent: number }>
}

export interface AdminDashboardSharingStats extends AdminStatsRange {
  dataQuality: AdminSharingDataQuality
  summary: {
    activeShares: number | null
    createdShares: AdminStatsDelta
    views: AdminStatsDelta
    downloads: AdminStatsDelta
    saves: AdminStatsDelta
    downloadsPer100Views: number | null
    savesPer100Views: number | null
    passwordPasses: number
  }
  trend: Array<{ date: string; views: number; downloads: number; saves: number }>
  typeBreakdown: Array<{ name: string; value: number; percent: number }>
  sourceBreakdown: Array<{ name: string; value: number; percent: number }>
  topShares: Array<AdminTopShare & { viewPercent: number; downloadPercent: number }>
}

export interface AdminDashboardOperationsStats extends AdminStatsRange {
  summary: {
    activeBackgroundJobs: number | null
    activeRemoteDownloads: number | null
    onlineDownloaders: number | null
    offlineDownloaders: number | null
    backgroundJobFailureRate: number | null
    remoteDownloadSuccessRate: number | null
    cloudReportBacklog: number | null
    cloudReportDeadLetters: number | null
    webhookFailures: number | null
    alertCount: number | null
  }
  trend: Array<{
    date: string
    completedJobs: number
    failedJobs: number
    completedRemoteDownloads: number
    failedRemoteDownloads: number
  }>
  backgroundJobOutcomes: Array<{ name: string; value: number; percent: number }>
  remoteDownloadOutcomes: Array<{ name: string; value: number; percent: number }>
  downloaderStatus: Array<{ name: string; value: number; percent: number }>
  cloudReportStatus: Array<{ name: string; value: number; percent: number }>
}
