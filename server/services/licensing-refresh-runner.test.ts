import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { licenseBindings } from '../db/schema.js'
import { createLicenseBinding } from '../licensing/license-state.js'
import * as refreshModule from '../licensing/refresh.js'
import { createTestApp } from '../test/setup.js'
import { runLicensingRefresh } from './licensing-refresh-runner.js'

const CLOUD_URL = 'https://cloud.zpan.space'

async function seedLicenseBinding(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  overrides: { lastRefreshAt?: number | null } = {},
) {
  await createLicenseBinding(db, {
    cloudBindingId: 'bind-1',
    instanceId: 'inst-1',
    cloudAccountId: 'acct-1',
    refreshToken: 'some-token',
    cachedCert: 'test-cert',
    cachedExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    lastRefreshAt: overrides.lastRefreshAt ?? 0,
  })
  if (overrides.lastRefreshAt === null) {
    await db.update(licenseBindings).set({ lastRefreshAt: null }).where(eq(licenseBindings.cloudBindingId, 'bind-1'))
  }
}

describe('runLicensingRefresh', () => {
  let performRefreshSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    performRefreshSpy = vi.spyOn(refreshModule, 'performRefresh')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns immediately with no-op when no license binding exists', async () => {
    const { db } = await createTestApp()

    await expect(runLicensingRefresh(db, CLOUD_URL)).resolves.toBeUndefined()
    expect(performRefreshSpy).not.toHaveBeenCalled()
  })

  it('skips performRefresh when lastRefreshAt is within 5 minutes', async () => {
    const { db } = await createTestApp()

    const recentRefresh = Math.floor(Date.now() / 1000) - 120
    await seedLicenseBinding(db, { lastRefreshAt: recentRefresh })

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).not.toHaveBeenCalled()
  })

  it('calls performRefresh when lastRefreshAt is older than 5 minutes', async () => {
    const { db } = await createTestApp()

    const oldRefresh = Math.floor(Date.now() / 1000) - 600
    await seedLicenseBinding(db, { lastRefreshAt: oldRefresh })

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).toHaveBeenCalledOnce()
    expect(performRefreshSpy).toHaveBeenCalledWith(db, CLOUD_URL)
  })

  it('calls performRefresh when lastRefreshAt is null', async () => {
    const { db } = await createTestApp()

    await seedLicenseBinding(db)

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).toHaveBeenCalledOnce()
  })

  it('logs licensing.refresh.ok on successful performRefresh', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await seedLicenseBinding(db)

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.ok')
  })

  it('logs licensing.refresh.error with Error message when performRefresh throws an Error', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedLicenseBinding(db)

    performRefreshSpy.mockRejectedValueOnce(new Error('network timeout'))

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.error code=network timeout')
  })

  it('logs licensing.refresh.error with stringified value when performRefresh throws a non-Error', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedLicenseBinding(db)

    performRefreshSpy.mockRejectedValueOnce('plain string error')

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.error code=plain string error')
  })

  it('does not throw when performRefresh throws', async () => {
    const { db } = await createTestApp()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await seedLicenseBinding(db)

    performRefreshSpy.mockRejectedValueOnce(new Error('unexpected'))

    await expect(runLicensingRefresh(db, CLOUD_URL)).resolves.toBeUndefined()
  })
})
