import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncPendingCloudTrafficReports } from '../server/services/cloud-traffic-metering'
import { INSTANCE_TELEMETRY_CRON, reportInstanceTelemetry } from '../server/services/instance-telemetry'
import { runLicensingRefresh } from '../server/services/licensing-refresh-runner'
import { syncPendingRemoteDownloadUsageReports } from '../server/services/remote-download-usage'
import { handleScheduled } from '../workers/scheduled'

vi.mock('../server/platform/cloudflare', () => ({
  createCloudflarePlatform: () => ({
    db: 'db',
  }),
}))

vi.mock('../server/services/cloud-traffic-metering', () => ({
  syncPendingCloudTrafficReports: vi.fn(),
}))

const { mockCreateQuotaRepo, mockResetExpiredTrafficQuotas } = vi.hoisted(() => {
  const resetExpiredTrafficQuotas = vi.fn()
  return {
    mockResetExpiredTrafficQuotas: resetExpiredTrafficQuotas,
    mockCreateQuotaRepo: vi.fn(() => ({ resetExpiredTrafficQuotas })),
  }
})

vi.mock('../server/adapters/repos/quota', () => ({
  createQuotaRepo: mockCreateQuotaRepo,
}))

vi.mock('../server/services/instance-telemetry', () => ({
  INSTANCE_TELEMETRY_CRON: '0 */12 * * *',
  reportInstanceTelemetry: vi.fn(),
}))

vi.mock('../server/services/licensing-refresh-runner', () => ({
  runLicensingRefresh: vi.fn(),
}))

vi.mock('../server/services/remote-download-usage', () => ({
  syncPendingRemoteDownloadUsageReports: vi.fn(),
}))

describe('handleScheduled', () => {
  beforeEach(() => {
    vi.mocked(syncPendingCloudTrafficReports).mockReset()
    vi.mocked(syncPendingRemoteDownloadUsageReports).mockReset()
    vi.mocked(reportInstanceTelemetry).mockReset()
    vi.mocked(runLicensingRefresh).mockReset()
    mockResetExpiredTrafficQuotas.mockReset()
  })

  it('syncs usage reports on the traffic cron only', async () => {
    await handleScheduled({ cron: '*/10 * * * *' }, { DB: {} as D1Database, ZPAN_CLOUD_URL: 'https://cloud.example' })

    expect(syncPendingCloudTrafficReports).toHaveBeenCalledWith({ db: 'db', cloudBaseUrl: 'https://cloud.example' })
    expect(syncPendingRemoteDownloadUsageReports).toHaveBeenCalledWith({
      db: 'db',
      cloudBaseUrl: 'https://cloud.example',
    })
    expect(runLicensingRefresh).not.toHaveBeenCalled()
    expect(reportInstanceTelemetry).not.toHaveBeenCalled()
  })

  it('refreshes licensing on the licensing cron only', async () => {
    await handleScheduled({ cron: '0 */6 * * *' }, { DB: {} as D1Database, ZPAN_CLOUD_URL: 'https://cloud.example' })

    expect(runLicensingRefresh).toHaveBeenCalledWith('db', 'https://cloud.example')
    expect(syncPendingCloudTrafficReports).not.toHaveBeenCalled()
    expect(syncPendingRemoteDownloadUsageReports).not.toHaveBeenCalled()
    expect(reportInstanceTelemetry).not.toHaveBeenCalled()
  })

  it('resets expired traffic quotas on the monthly reset cron only', async () => {
    await handleScheduled({ cron: '0 0 1 * *' }, { DB: {} as D1Database, ZPAN_CLOUD_URL: 'https://cloud.example' })

    expect(mockResetExpiredTrafficQuotas).toHaveBeenCalled()
    expect(mockCreateQuotaRepo).toHaveBeenCalledWith('db')
    expect(runLicensingRefresh).not.toHaveBeenCalled()
    expect(syncPendingCloudTrafficReports).not.toHaveBeenCalled()
    expect(syncPendingRemoteDownloadUsageReports).not.toHaveBeenCalled()
    expect(reportInstanceTelemetry).not.toHaveBeenCalled()
  })

  it('reports instance telemetry on the 12-hour telemetry cron only', async () => {
    await handleScheduled(
      { cron: INSTANCE_TELEMETRY_CRON },
      {
        DB: {} as D1Database,
        ZPAN_CLOUD_URL: 'https://cloud.example',
      },
    )

    expect(reportInstanceTelemetry).toHaveBeenCalledTimes(1)
    expect(reportInstanceTelemetry).toHaveBeenCalledWith({
      db: 'db',
      config: {
        allowIp: true,
      },
      cron: '0 */12 * * *',
      trigger: 'scheduled',
      runtime: {
        runtime: 'workerd',
        platform: 'cloudflare-workers',
      },
    })
    expect(runLicensingRefresh).not.toHaveBeenCalled()
    expect(syncPendingCloudTrafficReports).not.toHaveBeenCalled()
    expect(syncPendingRemoteDownloadUsageReports).not.toHaveBeenCalled()
  })
})
