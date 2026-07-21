import type { AdminOverview } from '@shared/types'
import { normalizeStatsRange } from './admin-stats'
import type { Deps } from './deps'
import { listDownloaders } from './downloads/downloads'

export async function getAdminOverview(deps: Deps, now = new Date()): Promise<AdminOverview> {
  const [statistics, storagePage, downloaders] = await Promise.all([
    deps.adminStats.getOverviewStatistics(now, normalizeStatsRange({}, now)),
    deps.storages.list(),
    listDownloaders(deps),
  ])

  const storageItems = storagePage.items.map((storage) => ({
    id: storage.id,
    provider: storage.provider,
    bucket: storage.bucket,
    status: storage.status,
    used: storage.used,
    capacity: storage.capacity,
    writable: storage.status === 'active' && (storage.capacity === 0 || storage.used < storage.capacity),
  }))
  const writableStorages = storageItems.filter((storage) => storage.writable).length
  const onlineDownloaders = downloaders.filter((downloader) => downloader.enabled && downloader.status === 'online')
  const activeTasks = onlineDownloaders.reduce((total, downloader) => total + downloader.currentTasks, 0)
  const totalSlots = onlineDownloaders.reduce((total, downloader) => total + downloader.maxConcurrentTasks, 0)
  const availableSlots = Math.max(0, totalSlots - activeTasks)
  const boundedStorages = storageItems.filter((storage) => storage.capacity > 0)

  return {
    observedAt: now.toISOString(),
    users: statistics.users,
    storages: {
      total: storageItems.length,
      writable: writableStorages,
      used: storageItems.reduce((total, storage) => total + storage.used, 0),
      capacity: boundedStorages.reduce((total, storage) => total + storage.capacity, 0),
      unbounded: storageItems.length - boundedStorages.length,
      trend: statistics.storageTrend,
      items: storageItems,
    },
    downloaders: {
      total: downloaders.length,
      online: onlineDownloaders.length,
      activeTasks,
      totalSlots,
      availableSlots,
      downloadBps: onlineDownloaders.reduce((total, downloader) => total + downloader.downloadBps, 0),
      uploadBps: onlineDownloaders.reduce((total, downloader) => total + downloader.uploadBps, 0),
      items: downloaders.map((downloader) => ({
        id: downloader.id,
        name: downloader.name,
        status: downloader.status,
        currentTasks: downloader.currentTasks,
        maxConcurrentTasks: downloader.maxConcurrentTasks,
        downloadBps: downloader.downloadBps,
        uploadBps: downloader.uploadBps,
        freeDiskBytes: downloader.freeDiskBytes,
        lastHeartbeatAt: downloader.lastHeartbeatAt,
      })),
    },
  }
}
