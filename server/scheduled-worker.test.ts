import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncPendingCloudTrafficReports } from '../server/services/cloud-traffic-metering'
import { runLicensingRefresh } from '../server/services/licensing-refresh-runner'
import { handleScheduled } from '../workers/scheduled'

vi.mock('../server/platform/cloudflare', () => ({
  createCloudflarePlatform: () => ({
    db: 'db',
  }),
}))

vi.mock('../server/services/cloud-traffic-metering', () => ({
  syncPendingCloudTrafficReports: vi.fn(),
}))

vi.mock('../server/services/licensing-refresh-runner', () => ({
  runLicensingRefresh: vi.fn(),
}))

describe('handleScheduled', () => {
  beforeEach(() => {
    vi.mocked(syncPendingCloudTrafficReports).mockReset()
    vi.mocked(runLicensingRefresh).mockReset()
  })

  it('syncs traffic reports on the traffic cron only', async () => {
    await handleScheduled({ cron: '*/10 * * * *' }, { DB: {} as D1Database, ZPAN_CLOUD_URL: 'https://cloud.example' })

    expect(syncPendingCloudTrafficReports).toHaveBeenCalledWith({ db: 'db', cloudBaseUrl: 'https://cloud.example' })
    expect(runLicensingRefresh).not.toHaveBeenCalled()
  })

  it('refreshes licensing on the licensing cron only', async () => {
    await handleScheduled({ cron: '0 */6 * * *' }, { DB: {} as D1Database, ZPAN_CLOUD_URL: 'https://cloud.example' })

    expect(runLicensingRefresh).toHaveBeenCalledWith('db', 'https://cloud.example')
    expect(syncPendingCloudTrafficReports).not.toHaveBeenCalled()
  })
})
