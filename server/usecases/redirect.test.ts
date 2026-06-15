import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type DownloadTrafficOutcome, meterDownloadTraffic, reportDownloadEgress } from './cloud-traffic-metering'
import type {
  ImageHostingRepo,
  ImageResolution,
  Matter,
  QuotaRepo,
  S3Gateway,
  ShareRecord,
  ShareRepo,
  ShareResolution,
  StorageRecord,
  StorageRepo,
} from './ports'
import { type RedirectDeps, resolveDirectShareDownload, resolveImageHostingDownload } from './redirect'

// The end-to-end metering (quota consume → cloud egress report → refund) is
// covered by cloud-traffic-metering.test.ts. Here we replace its two entry
// points with mocks so each redirect case feeds a chosen outcome and we can
// assert the redirect flow's gates, ordering, and presign-rollback in isolation.
// Everything else in the module (types, other exports) stays real.
vi.mock('./cloud-traffic-metering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-traffic-metering')>()),
  meterDownloadTraffic: vi.fn(),
  reportDownloadEgress: vi.fn(),
}))

const PRESIGNED_DOWNLOAD = 'https://presigned-download.example.com/file'
const PRESIGNED_INLINE = 'https://presigned-inline.example.com/image.png'
const CLOUD_BASE_URL = 'https://cloud.example.com'

const ok: DownloadTrafficOutcome = { ok: true }
const quotaExceeded: DownloadTrafficOutcome = { ok: false, reason: 'quota_exceeded' }
const insufficientCredits: DownloadTrafficOutcome = { ok: false, reason: 'insufficient_credits' }

const meter = vi.mocked(meterDownloadTraffic)
const reportEgress = vi.mocked(reportDownloadEgress)

const sampleStorage = { id: 'st-1', bucket: 'b', egressCreditBillingEnabled: false } as StorageRecord

const sampleMatter = {
  id: 'm-1',
  orgId: 'o-1',
  name: 'file.bin',
  object: 'some/key.bin',
  storageId: 'st-1',
  size: 1024,
} as Matter

const sampleShare = {
  id: 's-1',
  token: 'ds_token1',
  kind: 'direct',
  matterId: 'm-1',
  orgId: 'o-1',
  expiresAt: null,
  downloadLimit: null,
} as ShareRecord

const sampleImage = {
  id: 'ih-1',
  orgId: 'o-1',
  token: 'ih_token1',
  storageId: 'st-1',
  storageKey: 'ih/o-1/ih-1.png',
  size: 1024,
  mime: 'image/png',
} as ImageResolution['image']

function makeShareRepo(over: Partial<ShareRepo> = {}): ShareRepo {
  return {
    resolveByToken: async (): Promise<ShareResolution> => ({
      status: 'ok',
      share: sampleShare,
      matter: sampleMatter,
      recipients: [],
    }),
    hasDownloadsAvailable: async () => true,
    incrementDownloadsAtomic: async () => ({ ok: true, downloads: 1 }),
    decrementDownloads: async () => {},
    ...over,
  } as ShareRepo
}

function makeImageRepo(over: Partial<ImageHostingRepo> = {}): ImageHostingRepo {
  return {
    resolveActiveByToken: async (): Promise<ImageResolution | null> => ({
      image: sampleImage,
      refererAllowlist: [],
    }),
    incrementAccessCount: async () => {},
    ...over,
  } as ImageHostingRepo
}

function makeDeps(
  over: {
    share?: Partial<ShareRepo>
    imageHosting?: Partial<ImageHostingRepo>
    storages?: Partial<StorageRepo>
    s3?: Partial<S3Gateway>
    quota?: Partial<QuotaRepo>
  } = {},
) {
  const refundTraffic = vi.fn(async () => {})
  const incrementAccessCount = vi.fn(async () => {})
  const decrementDownloads = vi.fn(async () => {})
  const presignDownload = vi.fn(async () => PRESIGNED_DOWNLOAD)
  const presignInline = vi.fn(async () => PRESIGNED_INLINE)

  const deps = {
    share: makeShareRepo({ decrementDownloads, ...over.share }),
    imageHosting: makeImageRepo({ incrementAccessCount, ...over.imageHosting }),
    storages: { get: async () => sampleStorage, ...over.storages } as StorageRepo,
    s3: { presignDownload, presignInline, ...over.s3 } as S3Gateway,
    quota: { consumeTrafficIfQuotaAllows: async () => true, refundTraffic, ...over.quota } as QuotaRepo,
    // Cloud-metering ports are unused here — metering is mocked.
    licenseBinding: {} as RedirectDeps['licenseBinding'],
    licensingCloud: {} as RedirectDeps['licensingCloud'],
    cloudTrafficReports: {} as RedirectDeps['cloudTrafficReports'],
  } as RedirectDeps

  return { deps, refundTraffic, incrementAccessCount, decrementDownloads, presignDownload, presignInline }
}

beforeEach(() => {
  vi.clearAllMocks()
  meter.mockResolvedValue(ok)
  reportEgress.mockResolvedValue(ok)
})

// ─── resolveDirectShareDownload (ds_) ─────────────────────────────────────────

describe('resolveDirectShareDownload', () => {
  it('presigns the download and returns the URL on the happy path', async () => {
    const { deps, presignDownload } = makeDeps()
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: true, url: PRESIGNED_DOWNLOAD })
    expect(presignDownload).toHaveBeenCalledWith(sampleStorage, 'some/key.bin', 'file.bin', expect.any(Number))
  })

  it('passes cloudBaseUrl, source/sourceId, and a decrement onRejected to the meter', async () => {
    const { deps, decrementDownloads } = makeDeps()
    await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(meter).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        cloudBaseUrl: CLOUD_BASE_URL,
        orgId: 'o-1',
        bytes: 1024,
        storage: sampleStorage,
        source: 'direct_share',
        sourceId: 's-1',
        onRejected: expect.any(Function),
      }),
    )
    // The onRejected handed to the meter decrements the reserved download.
    const onRejected = meter.mock.calls[0][1].onRejected!
    await onRejected()
    expect(decrementDownloads).toHaveBeenCalledWith('s-1')
  })

  it('returns matter_trashed when the share resolves to a trashed matter', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'matter_trashed' }) } })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'matter_trashed' })
  })

  it('returns not_found when the token does not resolve', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'not_found' }) } })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found when the share is revoked', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found when the share kind is not direct (e.g. landing)', async () => {
    const landing = { ...sampleShare, kind: 'landing' } as ShareRecord
    const { deps } = makeDeps({
      share: {
        resolveByToken: async () => ({ status: 'ok', share: landing, matter: sampleMatter, recipients: [] }),
      },
    })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns expired when expiresAt is in the past', async () => {
    const expired = { ...sampleShare, expiresAt: new Date('2000-01-01') } as ShareRecord
    const { deps } = makeDeps({
      share: {
        resolveByToken: async () => ({ status: 'ok', share: expired, matter: sampleMatter, recipients: [] }),
      },
    })
    const out = await resolveDirectShareDownload(deps, {
      token: 'ds_token1',
      cloudBaseUrl: CLOUD_BASE_URL,
      now: new Date('2030-01-01'),
    })
    expect(out).toEqual({ ok: false, reason: 'expired' })
  })

  it('returns limit_exceeded when no downloads remain', async () => {
    const { deps, presignDownload } = makeDeps({ share: { hasDownloadsAvailable: async () => false } })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'limit_exceeded' })
    expect(presignDownload).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  it('returns limit_exceeded when the atomic increment loses the race', async () => {
    const { deps, presignDownload } = makeDeps({
      share: { incrementDownloadsAtomic: async () => ({ ok: false, downloads: 0 }) },
    })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'limit_exceeded' })
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('returns storage_not_found when the storage is missing', async () => {
    const { deps } = makeDeps({ storages: { get: async () => null } })
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'storage_not_found' })
  })

  it('returns quota_exceeded when the meter rejects on quota', async () => {
    meter.mockResolvedValue(quotaExceeded)
    const { deps, presignDownload } = makeDeps()
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'quota_exceeded' })
    // The meter owns the compensating decrement; presign never runs.
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('returns insufficient_credits when the meter rejects on credits', async () => {
    meter.mockResolvedValue(insufficientCredits)
    const { deps, presignDownload } = makeDeps()
    const out = await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(out).toEqual({ ok: false, reason: 'insufficient_credits' })
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('refunds traffic AND decrements the download when presign fails, then rethrows', async () => {
    const presignDownload = vi.fn(async () => {
      throw new Error('sign failed')
    })
    const { deps, refundTraffic, decrementDownloads } = makeDeps({ s3: { presignDownload } })
    await expect(
      resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL }),
    ).rejects.toThrow('sign failed')
    expect(refundTraffic).toHaveBeenCalledWith('o-1', 1024)
    expect(decrementDownloads).toHaveBeenCalledWith('s-1')
  })

  it('meters bytes=0 when the matter has no size', async () => {
    const sizeless = { ...sampleMatter, size: null } as Matter
    const { deps } = makeDeps({
      share: {
        resolveByToken: async () => ({ status: 'ok', share: sampleShare, matter: sizeless, recipients: [] }),
      },
    })
    await resolveDirectShareDownload(deps, { token: 'ds_token1', cloudBaseUrl: CLOUD_BASE_URL })
    expect(meter).toHaveBeenCalledWith(deps, expect.objectContaining({ bytes: 0 }))
  })
})

// ─── resolveImageHostingDownload (ih_) ────────────────────────────────────────

describe('resolveImageHostingDownload', () => {
  const baseParams = {
    token: 'ih_token1',
    cloudBaseUrl: CLOUD_BASE_URL,
    refererHeader: null,
    requestOrigin: 'https://app.example.com',
  }

  it('presigns inline and bumps the access count on the happy path', async () => {
    const { deps, presignInline, incrementAccessCount } = makeDeps()
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: true, url: PRESIGNED_INLINE })
    expect(presignInline).toHaveBeenCalledWith(sampleStorage, 'ih/o-1/ih-1.png', 'image/png', expect.any(Number))
    expect(incrementAccessCount).toHaveBeenCalledWith('ih-1')
  })

  it('returns not_found when the token does not resolve', async () => {
    const { deps } = makeDeps({ imageHosting: { resolveActiveByToken: async () => null } })
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: false, reason: 'not_found' })
  })

  it('allows any referer when the allowlist is empty', async () => {
    const { deps } = makeDeps()
    const out = await resolveImageHostingDownload(deps, {
      ...baseParams,
      refererHeader: 'https://anywhere.com/page',
    })
    expect(out.ok).toBe(true)
  })

  it('allows a missing referer even with a non-empty allowlist', async () => {
    const { deps } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    const out = await resolveImageHostingDownload(deps, { ...baseParams, refererHeader: null })
    expect(out.ok).toBe(true)
  })

  it('allows a referer whose origin is in the allowlist', async () => {
    const { deps } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    const out = await resolveImageHostingDownload(deps, {
      ...baseParams,
      refererHeader: 'https://blog.com/post/1',
    })
    expect(out.ok).toBe(true)
  })

  it('allows a same-origin referer even when not in the allowlist', async () => {
    const { deps } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    const out = await resolveImageHostingDownload(deps, {
      ...baseParams,
      requestOrigin: 'https://app.example.com',
      refererHeader: 'https://app.example.com/gallery',
    })
    expect(out.ok).toBe(true)
  })

  it('returns forbidden_referer for an off-allowlist cross-origin referer', async () => {
    const { deps, incrementAccessCount } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    const out = await resolveImageHostingDownload(deps, {
      ...baseParams,
      refererHeader: 'https://evil.com/page',
    })
    expect(out).toEqual({ ok: false, reason: 'forbidden_referer' })
    expect(incrementAccessCount).not.toHaveBeenCalled()
  })

  it('returns forbidden_referer for a subdomain (exact origin match required)', async () => {
    const { deps } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    const out = await resolveImageHostingDownload(deps, {
      ...baseParams,
      refererHeader: 'https://sub.blog.com/page',
    })
    expect(out).toEqual({ ok: false, reason: 'forbidden_referer' })
  })

  it('throws on a malformed referer (same-origin check parses it unguarded → 500 at http)', async () => {
    const { deps } = makeDeps({
      imageHosting: {
        resolveActiveByToken: async () => ({ image: sampleImage, refererAllowlist: ['https://blog.com'] }),
      },
    })
    await expect(resolveImageHostingDownload(deps, { ...baseParams, refererHeader: 'not a url' })).rejects.toThrow()
  })

  it('returns storage_not_found when the storage is missing', async () => {
    const { deps } = makeDeps({ storages: { get: async () => null } })
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: false, reason: 'storage_not_found' })
  })

  it('returns quota_exceeded before presigning when the quota is exhausted', async () => {
    const { deps, presignInline, incrementAccessCount } = makeDeps({
      quota: { consumeTrafficIfQuotaAllows: async () => false },
    })
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: false, reason: 'quota_exceeded' })
    expect(presignInline).not.toHaveBeenCalled()
    expect(incrementAccessCount).not.toHaveBeenCalled()
  })

  it('refunds traffic and rethrows when presign fails (no access-count bump)', async () => {
    const presignInline = vi.fn(async () => {
      throw new Error('sign failed')
    })
    const { deps, refundTraffic, incrementAccessCount } = makeDeps({ s3: { presignInline } })
    await expect(resolveImageHostingDownload(deps, baseParams)).rejects.toThrow('sign failed')
    expect(refundTraffic).toHaveBeenCalledWith('o-1', 1024)
    expect(incrementAccessCount).not.toHaveBeenCalled()
  })

  it('reports egress AFTER presigning and bumps the access count last', async () => {
    const calls: string[] = []
    const presignInline = vi.fn(async () => {
      calls.push('presign')
      return PRESIGNED_INLINE
    })
    const incrementAccessCount = vi.fn(async () => {
      calls.push('count')
    })
    reportEgress.mockImplementation(async () => {
      calls.push('report')
      return ok
    })
    const { deps } = makeDeps({ s3: { presignInline }, imageHosting: { incrementAccessCount } })
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out.ok).toBe(true)
    expect(calls).toEqual(['presign', 'report', 'count'])
    expect(reportEgress).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ orgId: 'o-1', bytes: 1024, source: 'image_hosting', sourceId: 'ih-1' }),
    )
  })

  it('returns insufficient_credits and skips the access-count bump when the egress report is blocked', async () => {
    reportEgress.mockResolvedValue(insufficientCredits)
    const { deps, incrementAccessCount } = makeDeps()
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: false, reason: 'insufficient_credits' })
    expect(incrementAccessCount).not.toHaveBeenCalled()
  })

  it('still succeeds when the access-count bump throws (best-effort)', async () => {
    const incrementAccessCount = vi.fn(async () => {
      throw new Error('count failed')
    })
    const { deps } = makeDeps({ imageHosting: { incrementAccessCount } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await resolveImageHostingDownload(deps, baseParams)
    expect(out).toEqual({ ok: true, url: PRESIGNED_INLINE })
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
