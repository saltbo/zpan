import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../db/schema.js'
import * as refreshModule from '../licensing/refresh.js'
import { createTestApp } from '../test/setup.js'
import { runLicensingRefresh } from './licensing-refresh-runner.js'

const CLOUD_URL = 'https://cloud.zpan.space'

describe('runLicensingRefresh', () => {
  let performRefreshSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    performRefreshSpy = vi.spyOn(refreshModule, 'performRefresh')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns immediately with no-op when no licenseBinding row exists', async () => {
    const { db } = await createTestApp()

    await expect(runLicensingRefresh(db, CLOUD_URL)).resolves.toBeUndefined()
    expect(performRefreshSpy).not.toHaveBeenCalled()
  })

  it('skips performRefresh when lastRefreshAt is within 5 minutes', async () => {
    const { db } = await createTestApp()

    const nowSec = Math.floor(Date.now() / 1000)
    // 2 minutes ago — still within the 5-minute dedup window
    const recentRefresh = nowSec - 120

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: recentRefresh,
      lastRefreshError: null,
      boundAt: null,
    })

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).not.toHaveBeenCalled()
  })

  it('calls performRefresh when lastRefreshAt is older than 5 minutes', async () => {
    const { db } = await createTestApp()

    const nowSec = Math.floor(Date.now() / 1000)
    // 10 minutes ago — outside the 5-minute dedup window
    const oldRefresh = nowSec - 600

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: oldRefresh,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).toHaveBeenCalledOnce()
    expect(performRefreshSpy).toHaveBeenCalledWith(db, CLOUD_URL)
  })

  it('calls performRefresh when lastRefreshAt is null', async () => {
    const { db } = await createTestApp()

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(performRefreshSpy).toHaveBeenCalledOnce()
  })

  it('logs licensing.refresh.ok on successful performRefresh', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockResolvedValueOnce(undefined)

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.ok')
  })

  it('logs licensing.refresh.error with Error message when performRefresh throws an Error', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockRejectedValueOnce(new Error('network timeout'))

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.error code=network timeout')
  })

  it('logs licensing.refresh.error with stringified value when performRefresh throws a non-Error', async () => {
    const { db } = await createTestApp()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockRejectedValueOnce('plain string error')

    await runLicensingRefresh(db, CLOUD_URL)

    expect(consoleSpy).toHaveBeenCalledWith('licensing.refresh.error code=plain string error')
  })

  it('does not throw when performRefresh throws', async () => {
    const { db } = await createTestApp()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await db.insert(schema.licenseBinding).values({
      id: 1,
      instanceId: 'inst-1',
      refreshToken: 'some-token',
      cachedCert: null,
      cachedExpiresAt: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      boundAt: null,
    })

    performRefreshSpy.mockRejectedValueOnce(new Error('unexpected'))

    await expect(runLicensingRefresh(db, CLOUD_URL)).resolves.toBeUndefined()
  })
})
