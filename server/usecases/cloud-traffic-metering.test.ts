import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { createLicensingCloudGateway } from '../adapters/gateways/licensing-cloud'
import { createCloudTrafficReportRepo } from '../adapters/repos/cloud-traffic-report'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import { cloudTrafficReports } from '../db/schema'
import type { Database, Platform } from '../platform/interface'
import { createTestApp } from '../test/setup'
import {
  CloudTrafficBlockedError,
  type CloudTrafficMeteringDeps,
  reportTrafficEgress as reportTrafficEgressUsecase,
  syncPendingCloudTrafficReports as syncPendingCloudTrafficReportsUsecase,
  type TrafficReportSource,
} from './cloud-traffic-metering'

const hasFeatureMock = vi.hoisted(() => vi.fn(() => true))

vi.mock('../domain/licensing', () => ({
  hasFeature: hasFeatureMock,
}))
vi.mock('./licensing', () => ({
  loadBindingState: vi.fn(async () => ({ bound: true, active: true, edition: 'business', features: ['quota_store'] })),
}))

function meteringDeps(db: Database): CloudTrafficMeteringDeps {
  return {
    licenseBinding: createLicenseBindingRepo(db),
    licensingCloud: createLicensingCloudGateway(),
    cloudTrafficReports: createCloudTrafficReportRepo(db),
  }
}

function cloudBaseUrlOf(platform: Platform): string {
  return platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
}

// Adapters preserving the pre-migration call shape (the service took `platform`;
// the usecase takes `deps` + an explicit cloudBaseUrl).
function reportTrafficEgress(params: {
  platform: Platform
  orgId: string
  bytes: number
  storageId?: string | null
  egressCreditBillingEnabled?: boolean
  egressCreditUnitBytes?: number | null
  egressCreditPerUnit?: number | null
  source: TrafficReportSource
  sourceId: string
  eventId?: string
  now?: Date
}) {
  const { platform, ...rest } = params
  return reportTrafficEgressUsecase(meteringDeps(platform.db), { cloudBaseUrl: cloudBaseUrlOf(platform), ...rest })
}

function syncPendingCloudTrafficReports(params: { db: Database; cloudBaseUrl: string; limit?: number; now?: Date }) {
  const { db, ...rest } = params
  return syncPendingCloudTrafficReportsUsecase(meteringDeps(db), rest)
}

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name)
}

async function seedTrafficBinding(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'test-binding',
    cloudStoreId: 'store-test-binding',
    instanceId: 'test-instance',
    cloudAccountId: 'test-account',
    refreshToken: 'test-refresh-token',
    cachedCert: 'test-certificate',
    cachedExpiresAt: expiresAt,
    lastRefreshAt: issuedAt,
  })
}

const meteredStorage = {
  storageId: 'storage_1',
  egressCreditBillingEnabled: true,
  egressCreditUnitBytes: 100 * 1024 ** 2,
  egressCreditPerUnit: 1,
}

describe('cloud traffic metering', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    hasFeatureMock.mockReset()
    hasFeatureMock.mockReturnValue(true)
  })

  it('reports traffic egress to Cloud from the request path', async () => {
    const { db, platform } = await createTestApp({ ZPAN_CLOUD_URL: 'https://cloud.example' })
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_1' } })),
    )

    const result = await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'object_download',
      sourceId: 'matter_1',
      eventId: 'evt_1',
      ...meteredStorage,
    })

    expect(result).toMatchObject({ status: 'reported', eventId: 'evt_1', duplicate: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([{ status: 'reported' }])
  })

  it('syncs pending traffic reports to Cloud outside the request path', async () => {
    const { db, platform } = await createTestApp({ ZPAN_CLOUD_URL: 'https://cloud.example' })
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_1' } })),
    )
    await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'object_download',
      sourceId: 'matter_1',
      eventId: 'evt_1',
      ...meteredStorage,
    })

    const result = await syncPendingCloudTrafficReports({ db, cloudBaseUrl: 'https://cloud.example' })

    expect(result).toEqual({ attempted: 0, reported: 0, blocked: 0, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cloud.example/api/stores/store-test-binding/billing/usage-events')
    expect(headerValue(init.headers, 'Authorization')).toBe('Bearer test-refresh-token')
    expect(JSON.parse(init.body as string)).toMatchObject({
      resource: 'storage_egress',
      unit: 'byte',
      bytes: 1024,
      eventId: 'evt_1',
      idempotencyKey: 'evt_1',
      customerId: 'org_1',
      usageContext: { storageId: 'storage_1' },
      pricing: { unitQuantity: 100 * 1024 ** 2, creditsPerUnit: 1 },
    })
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([{ status: 'reported' }])
  })

  it('ignores zero-byte reports without writing local state', async () => {
    const { db, platform } = await createTestApp()
    vi.stubGlobal('fetch', vi.fn())

    const result = await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 0,
      source: 'object_download',
      sourceId: 'matter_1',
    })

    expect(result).toMatchObject({ status: 'reported', eventId: '', duplicate: false })
    expect(fetch).not.toHaveBeenCalled()
    await expect(db.select().from(cloudTrafficReports)).resolves.toHaveLength(0)
  })

  it('keeps idempotent reports local after the first reported request', async () => {
    const { db, platform } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_dup' } })),
    )

    const input = {
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'direct_share' as const,
      sourceId: 'share_1',
      eventId: 'evt_dup',
      ...meteredStorage,
    }
    const first = await reportTrafficEgress(input)
    const second = await reportTrafficEgress(input)

    expect(first.duplicate).toBe(false)
    expect(second).toMatchObject({ duplicate: true, eventId: 'evt_dup', status: 'reported' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(db.select().from(cloudTrafficReports)).resolves.toHaveLength(1)
  })

  it('rejects idempotency conflicts for reused event ids', async () => {
    const { db, platform } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_conflict' } })),
    )

    await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'direct_share',
      sourceId: 'share_1',
      eventId: 'evt_conflict',
      ...meteredStorage,
    })

    await expect(
      reportTrafficEgress({
        platform,
        orgId: 'org_1',
        bytes: 2048,
        source: 'direct_share',
        sourceId: 'share_1',
        eventId: 'evt_conflict',
        ...meteredStorage,
      }),
    ).rejects.toThrow('traffic_report_idempotency_conflict')
  })

  it('records Cloud credit rejection during the request path', async () => {
    const { db, platform } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ error: { code: 'insufficient_credits' } }, 402)))

    await expect(
      reportTrafficEgress({
        platform,
        orgId: 'org_1',
        bytes: 1024,
        source: 'landing_share',
        sourceId: 'share_1',
        eventId: 'evt_blocked',
        ...meteredStorage,
      }),
    ).rejects.toThrow(CloudTrafficBlockedError)

    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { eventId: 'evt_blocked', status: 'blocked', error: 'insufficient_credits' },
    ])
    await expect(
      reportTrafficEgress({
        platform,
        orgId: 'org_1',
        bytes: 1024,
        source: 'landing_share',
        sourceId: 'share_1',
        eventId: 'evt_blocked',
        ...meteredStorage,
      }),
    ).rejects.toThrow(CloudTrafficBlockedError)
  })

  it('retries failed report ids during later background syncs', async () => {
    const { db, platform } = await createTestApp()
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'evt_retry' } })),
    )

    const input = {
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'object_download' as const,
      sourceId: 'matter_1',
      eventId: 'evt_retry',
      now: new Date('2026-04-30T23:59:00.000Z'),
      ...meteredStorage,
    }
    await expect(reportTrafficEgress(input)).resolves.toMatchObject({ status: 'failed', eventId: 'evt_retry' })
    await expect(syncPendingCloudTrafficReports({ db, cloudBaseUrl: 'https://cloud.example' })).resolves.toEqual({
      attempted: 1,
      reported: 1,
      blocked: 0,
      failed: 0,
    })

    const result = await syncPendingCloudTrafficReports({
      db,
      cloudBaseUrl: 'https://cloud.example',
      now: new Date('2026-05-01T00:01:00.000Z'),
    })

    expect(result).toEqual({ attempted: 0, reported: 0, blocked: 0, failed: 0 })
    expect(fetch).toHaveBeenCalledTimes(2)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { status: 'reported', error: null, period: '2026-04' },
    ])
  })

  it('marks reports reported when Cloud returns its own usage event id', async () => {
    const { db, platform } = await createTestApp({ ZPAN_CLOUD_URL: 'https://cloud.example' })
    await seedTrafficBinding(db)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse({ data: { accepted: true, duplicate: false, eventId: 'other_evt' } })),
    )

    const result = await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'object_download',
      sourceId: 'matter_1',
      eventId: 'evt_mismatch',
      ...meteredStorage,
    })

    expect(result).toMatchObject({ status: 'reported', eventId: 'evt_mismatch', duplicate: false })
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      { eventId: 'evt_mismatch', status: 'reported', error: null },
    ])
  })

  it('records skipped reporting when no active binding exists', async () => {
    const { db, platform } = await createTestApp()
    hasFeatureMock.mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn())

    const result = await reportTrafficEgress({
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'image_hosting',
      sourceId: 'image_1',
      eventId: 'evt_unbound',
      ...meteredStorage,
    })

    expect(result.status).toBe('reported')
    expect(fetch).not.toHaveBeenCalled()
    await expect(db.select().from(cloudTrafficReports)).resolves.toHaveLength(0)
  })

  it('keeps unbound report replays local', async () => {
    const { db, platform } = await createTestApp()
    hasFeatureMock.mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn())

    const input = {
      platform,
      orgId: 'org_1',
      bytes: 1024,
      source: 'image_hosting' as const,
      sourceId: 'image_1',
      eventId: 'evt_unbound_dup',
      ...meteredStorage,
    }
    const first = await reportTrafficEgress(input)
    const second = await reportTrafficEgress(input)

    expect(first.duplicate).toBe(false)
    expect(second).toMatchObject({ status: 'reported', eventId: 'evt_unbound_dup', duplicate: false })
    expect(fetch).not.toHaveBeenCalled()
    await expect(db.select().from(cloudTrafficReports)).resolves.toHaveLength(0)
  })
})
