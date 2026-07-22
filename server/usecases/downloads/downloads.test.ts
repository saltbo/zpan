import type { BindingState, Downloader } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloaderRecord, DownloaderRepo } from '../ports'
import { type AppError, DownloadError } from '../ports'
import { loadBindingState } from '../site/licensing'
import { type DownloadsDeps, updateDownloaderCreditBilling } from './downloads'

vi.mock('../site/licensing', () => ({ loadBindingState: vi.fn() }))

const PRO: BindingState = { bound: true, active: true, edition: 'pro' }
const BUSINESS: BindingState = { bound: true, active: true, edition: 'business' }

const downloader: Downloader = {
  id: 'downloader-1',
  name: 'Edge worker',
  status: 'offline',
  enabled: true,
  version: '1.0.0',
  hostname: 'edge-1',
  platform: 'linux',
  arch: 'amd64',
  engine: 'aria2',
  capabilities: ['http'],
  maxConcurrentTasks: 2,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024,
  remoteDownloadCreditBillingEnabled: true,
  remoteDownloadCreditUnitBytes: 1024,
  remoteDownloadCreditPerUnit: 2,
  lastHeartbeatAt: null,
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const downloaderRecord = {
  ...downloader,
  tokenHash: 'hash',
  tokenJti: 'jti',
  lastHeartbeatAt: null,
  createdAt: new Date(downloader.createdAt),
  updatedAt: new Date(downloader.updatedAt),
} satisfies DownloaderRecord

function makeDeps(downloaders: Partial<DownloaderRepo> = {}) {
  const update = vi.fn(async () => {})
  const repo: DownloaderRepo = {
    insert: async () => {},
    list: async () => [],
    get: async () => downloader,
    getRecord: async () => downloaderRecord,
    findRecord: async () => downloaderRecord,
    update,
    recordHeartbeat: async () => {},
    delete: async () => {},
    listAssignmentCandidates: async () => [],
    listStaleIds: async () => [],
    listUnreachableIds: async () => [],
    markStaleOffline: async () => {},
    ...downloaders,
  }
  return {
    deps: {
      downloaders: repo,
      downloadTasks: {},
      downloadTokens: {},
      licenseBinding: {},
      licensingCloud: {},
      remoteDownloadUsage: {},
      audit: {},
    } as DownloadsDeps,
    update,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('updateDownloaderCreditBilling', () => {
  it('updates credit billing fields through the downloader repo', async () => {
    vi.mocked(loadBindingState).mockResolvedValue(BUSINESS)
    const { deps, update } = makeDeps()

    const out = await updateDownloaderCreditBilling(deps, 'downloader-1', {
      enabled: true,
      unitBytes: 2048,
      creditsPerUnit: 3,
    })

    expect(out).toBe(downloader)
    expect(update).toHaveBeenCalledWith(
      'downloader-1',
      {
        remoteDownloadCreditBillingEnabled: true,
        remoteDownloadCreditUnitBytes: 2048,
        remoteDownloadCreditPerUnit: 3,
      },
      expect.any(Date),
    )
  })

  it('blocks enabling credit billing when quota_store is unavailable', async () => {
    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    const { deps, update } = makeDeps()

    await expect(
      updateDownloaderCreditBilling(deps, 'downloader-1', {
        enabled: true,
        unitBytes: 2048,
        creditsPerUnit: 3,
      }),
    ).rejects.toMatchObject({
      name: 'AppError',
      httpStatus: 402,
      meta: { reason: 'FEATURE_NOT_AVAILABLE', metadata: { feature: 'quota_store' } },
    } satisfies Partial<AppError>)
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves not_found when credit billing is disabled for a missing downloader', async () => {
    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    const { deps, update } = makeDeps({
      getRecord: async () => {
        throw new DownloadError('not_found')
      },
    })

    await expect(
      updateDownloaderCreditBilling(deps, 'missing', {
        enabled: false,
        unitBytes: 2048,
        creditsPerUnit: 3,
      }),
    ).rejects.toMatchObject({ name: 'DownloadError', code: 'not_found' })
    expect(update).not.toHaveBeenCalled()
  })

  it('preserves not_found before quota_store gating for a missing downloader when credit billing is enabled', async () => {
    vi.mocked(loadBindingState).mockResolvedValue(PRO)
    const { deps, update } = makeDeps({
      getRecord: async () => {
        throw new DownloadError('not_found')
      },
    })

    await expect(
      updateDownloaderCreditBilling(deps, 'missing', {
        enabled: true,
        unitBytes: 2048,
        creditsPerUnit: 3,
      }),
    ).rejects.toMatchObject({ name: 'DownloadError', code: 'not_found' })
    expect(update).not.toHaveBeenCalled()
  })
})
