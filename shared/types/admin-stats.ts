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

export interface AdminStatsRange {
  generatedAt: string
  from: string
  to: string
}

export interface AdminStatsDelta {
  value: number
  previousValue: number
  changePercent: number | null
}

export interface AdminTransferDataQuality {
  missingUploadBytesEvents: number
  previousMissingUploadBytesEvents: number
  missingDownloadBytesEvents: number
  previousMissingDownloadBytesEvents: number
}

export interface AdminDashboardOverviewStats extends AdminStatsRange {
  dataQuality: AdminTransferDataQuality
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
    storageUsedBytes: number | null
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
  dataQuality: AdminTransferDataQuality
  summary: {
    storageUsedBytes: number
    quotaBytes: number
    fileCount: number
    newFiles: AdminStatsDelta
    newBytes: AdminStatsDelta
    coldFileBytes: number
  }
  storageTrend: Array<{ date: string; usedBytes: number | null; newBytes: number; newFiles: number }>
  typeBreakdown: Array<{ type: string; bytes: number; files: number; percent: number }>
  sizeBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
  ageBreakdown: Array<{ name: string; bytes: number; files: number; percent: number }>
}

export interface AdminDashboardTrafficStats extends AdminStatsRange {
  dataQuality: AdminTransferDataQuality
  summary: {
    totalBytes: AdminStatsDelta
    requestCount: AdminStatsDelta
    issuedDownloads: number
    blockedDownloads: number
    issueRate: number | null
    peakDailyBytes: number
  }
  trafficTrend: Array<{ date: string; uploadBytes: number; downloadBytes: number; requests: number }>
  sourceBreakdown: Array<{ name: string; bytes: number; requests: number; percent: number }>
  issueStatus: Array<{ status: string; count: number; percent: number }>
  bandwidthTrend: Array<{ date: string; bytes: number }>
  successTrend: Array<{ date: string; uploadSuccessRate: number | null; downloadSuccessRate: number | null }>
  failureReasons: Array<{ name: string; value: number; percent: number }>
}

export interface AdminDashboardSharingStats extends AdminStatsRange {
  summary: {
    activeShares: number
    createdShares: AdminStatsDelta
    views: AdminStatsDelta
    downloads: AdminStatsDelta
    saves: AdminStatsDelta
    downloadConversionRate: number | null
    passwordPasses: number
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
