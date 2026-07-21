export interface AdminOverviewStorage {
  id: string
  provider: string
  bucket: string
  status: string
  used: number
  capacity: number
  writable: boolean
}

export interface AdminOverviewDownloader {
  id: string
  name: string
  status: 'online' | 'offline' | 'disabled'
  currentTasks: number
  maxConcurrentTasks: number
  downloadBps: number
  uploadBps: number
  freeDiskBytes: number
  lastHeartbeatAt: string | null
}

export interface AdminOverviewUserUsage {
  userId: string
  name: string
  email: string
  usedBytes: number
  quotaBytes: number
  utilization: number | null
}

export interface AdminOverviewStatistics {
  users: {
    total: number | null
    active30Days: number | null
    new7Days: number
    activity: {
      today: number | null
      last7Days: number | null
      last30Days: number | null
      inactive: number | null
    }
    trend: Array<{
      date: string
      totalUsers: number | null
      activeUsers: number | null
      newUsers: number
    }>
    topUsage: AdminOverviewUserUsage[]
  }
  storageTrend: Array<{ date: string; usedBytes: number | null }>
}

export interface AdminOverview {
  observedAt: string
  users: AdminOverviewStatistics['users']
  storages: {
    total: number
    writable: number
    used: number
    capacity: number
    unbounded: number
    trend: AdminOverviewStatistics['storageTrend']
    items: AdminOverviewStorage[]
  }
  downloaders: {
    total: number
    online: number
    activeTasks: number
    totalSlots: number
    availableSlots: number
    downloadBps: number
    uploadBps: number
    items: AdminOverviewDownloader[]
  }
}
