import type { AdminOverviewStatistics, Downloader, Storage } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { getAdminOverview } from './admin-overview'
import type { Deps } from './deps'

const now = new Date('2026-07-20T18:00:00.000Z')

const statistics: AdminOverviewStatistics = {
  users: {
    total: 42,
    active30Days: 18,
    new7Days: 5,
    activity: { total: 42, today: 3, last7Days: 5, last30Days: 10, inactive: 24 },
    trend: [{ date: '2026-07-20', totalUsers: 42, activeUsers: 18, newUsers: 2 }],
    topUsage: [
      {
        userId: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        usedBytes: 400,
        quotaBytes: 1000,
        utilization: 40,
      },
    ],
  },
  storageTrend: [{ date: '2026-07-20', usedBytes: 400, writtenBytes: 120, releasedBytes: 20 }],
}

function storage(overrides: Partial<Storage> = {}): Storage {
  return {
    id: 'storage-1',
    provider: 'aws-s3',
    bucket: 'files',
    endpoint: 'https://s3.example.com',
    region: 'auto',
    accessKey: 'secret-access-key',
    secretKey: 'secret-secret-key',
    filePath: '',
    customHost: null,
    capacity: 1000,
    forcePathStyle: true,
    egressCreditBillingEnabled: false,
    egressCreditUnitBytes: 100,
    egressCreditPerUnit: 1,
    used: 400,
    enabled: true,
    status: 'healthy',
    statusReason: null,
    statusCheckedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

function downloader(overrides: Partial<Downloader> = {}): Downloader {
  return {
    id: 'downloader-1',
    name: 'edge-1',
    status: 'online',
    enabled: true,
    version: '1.0.0',
    hostname: 'edge-1',
    platform: 'linux',
    arch: 'amd64',
    engine: 'aria2',
    capabilities: ['http'],
    maxConcurrentTasks: 4,
    currentTasks: 2,
    downloadBps: 100,
    uploadBps: 50,
    freeDiskBytes: 1000,
    remoteDownloadCreditBillingEnabled: false,
    remoteDownloadCreditUnitBytes: 100,
    remoteDownloadCreditPerUnit: 1,
    lastHeartbeatAt: now.toISOString(),
    createdBy: 'admin-1',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  }
}

function makeDeps(options: { storages?: Storage[]; downloaders?: Downloader[] } = {}): Deps {
  const storageItems = options.storages ?? [storage()]
  return {
    adminStats: {
      getOverviewStatistics: vi.fn(async () => statistics),
    },
    storages: {
      list: vi.fn(async () => ({ items: storageItems, total: storageItems.length })),
    },
    downloaders: {
      list: vi.fn(async () => options.downloaders ?? [downloader()]),
      listUnreachableIds: vi.fn(async () => []),
      listStaleIds: vi.fn(async () => []),
    },
    downloadTasks: {
      clearStaleSeedingRuntime: vi.fn(async () => undefined),
    },
  } as unknown as Deps
}

describe('getAdminOverview', () => {
  it('combines statistics with live storage and downloader state without exposing credentials', async () => {
    const result = await getAdminOverview(makeDeps(), now)

    expect(result.users).toEqual(statistics.users)
    expect(result.storages).toMatchObject({ total: 1, writable: 1, used: 400, capacity: 1000, unbounded: 0 })
    expect(result.storages.items[0]).not.toHaveProperty('accessKey')
    expect(result.storages.items[0]).not.toHaveProperty('secretKey')
    expect(result.downloaders).toMatchObject({
      total: 1,
      online: 1,
      activeTasks: 2,
      totalSlots: 4,
      availableSlots: 2,
      downloadBps: 100,
      uploadBps: 50,
    })
  })

  it('separates bounded capacity from unlimited backends', async () => {
    const deps = makeDeps({ storages: [storage(), storage({ id: 'storage-2', capacity: 0, used: 200 })] })
    const result = await getAdminOverview(deps, now)

    expect(result.storages).toMatchObject({ total: 2, writable: 2, used: 600, capacity: 1000, unbounded: 1 })
  })

  it('aggregates only enabled online downloaders into live totals', async () => {
    const deps = makeDeps({
      downloaders: [
        downloader(),
        downloader({ id: 'offline', status: 'offline', currentTasks: 0, downloadBps: 500, uploadBps: 250 }),
        downloader({ id: 'disabled', status: 'online', enabled: false, downloadBps: 700, uploadBps: 350 }),
      ],
    })
    const result = await getAdminOverview(deps, now)

    expect(result.downloaders).toMatchObject({ total: 3, online: 1, downloadBps: 100, uploadBps: 50 })
    expect(result.downloaders.items).toHaveLength(3)
  })
})
