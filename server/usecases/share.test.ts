import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeChildRef } from '../http/share-utils'
import { hashPassword } from '../lib/password'
import type { Platform } from '../platform/interface'
import { saveShareToDrive } from './object'
import {
  type ActivityRepo,
  AppError,
  CreateShareError,
  type Matter,
  type MatterListResult,
  type MatterRepo,
  type OrgRepo,
  type QuotaRepo,
  type S3Gateway,
  type ShareListItem,
  type ShareRecipientRecord,
  type ShareRecord,
  type ShareRepo,
  type ShareResolution,
  type StorageRecord,
  type StorageRepo,
} from './ports'
import {
  createShare,
  downloadShareObject,
  listShareObjects,
  listShares,
  revokeShare,
  type ShareDeps,
  saveShare,
  verifySharePassword,
  viewShare,
} from './share'
import { type DownloadTrafficOutcome, meterDownloadTraffic } from './store/traffic-metering'

// The end-to-end metering (quota consume → cloud egress report → refund) is
// covered by cloud-traffic-metering.test.ts; the recipient fan-out and the copy
// engine by share-notification/save-to-drive tests. Here we replace those three
// collaborators with mocks so each share case feeds a chosen outcome and we can
// assert the share routes' gates, ordering, DTO shaping, and presign-rollback in
// isolation. Everything else (types, pure helpers) stays real.
vi.mock('./store/traffic-metering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./store/traffic-metering')>()),
  meterDownloadTraffic: vi.fn(),
}))
vi.mock('./object', () => ({ saveShareToDrive: vi.fn() }))

const PRESIGNED_URL = 'https://presigned.example.com/file'
const CLOUD_BASE_URL = 'https://cloud.example.com'

const meterOk: DownloadTrafficOutcome = { ok: true }
const meterQuotaExceeded: DownloadTrafficOutcome = { ok: false, reason: 'quota_exceeded' }
const meterInsufficientCredits: DownloadTrafficOutcome = { ok: false, reason: 'insufficient_credits' }

// Asserts a usecase returned a failure AppError carrying the given HTTP status,
// wire reason, and message — the AIP-193 fields the http boundary renders.
function expectError(
  out: { ok: true } | { ok: false; error: AppError },
  httpStatus: number,
  reason: string | undefined,
  message: string,
) {
  expect(out.ok).toBe(false)
  const { error } = out as { ok: false; error: AppError }
  expect(error).toBeInstanceOf(AppError)
  expect(error.httpStatus).toBe(httpStatus)
  expect(error.meta.reason).toBe(reason)
  expect(error.message).toBe(message)
}

const meter = vi.mocked(meterDownloadTraffic)
const saveToDrive = vi.mocked(saveShareToDrive)

const platform = {} as Platform

const sampleStorage = { id: 'st-1', bucket: 'b', egressCreditBillingEnabled: false } as StorageRecord

const fileMatter = {
  id: 'm-1',
  orgId: 'o-1',
  name: 'file.bin',
  type: 'application/octet-stream',
  size: 1024,
  dirtype: 0, // DirType.FILE
  parent: '',
  object: 'some/key.bin',
  storageId: 'st-1',
} as Matter

const folderMatter = {
  id: 'fld-1',
  orgId: 'o-1',
  name: 'docs',
  type: 'folder',
  size: 0,
  dirtype: 1, // not FILE
  parent: 'root',
  object: '',
  storageId: 'st-1',
} as Matter

const childMatter = { ...fileMatter, id: 'm-child', name: 'child.txt' } as Matter

const landingShare = {
  id: 's-1',
  token: 'sk_token1',
  kind: 'landing',
  matterId: 'm-1',
  orgId: 'o-1',
  creatorId: 'creator-1',
  passwordHash: null,
  expiresAt: null,
  downloadLimit: null,
  views: 3,
  downloads: 2,
  status: 'active',
  createdAt: new Date('2024-01-01T00:00:00Z'),
} as ShareRecord

const okResolution = (
  over: { share?: ShareRecord; matter?: Matter; recipients?: ShareRecipientRecord[] } = {},
): ShareResolution => ({ status: 'ok', share: landingShare, matter: fileMatter, recipients: [], ...over })

const trashedResolution = (
  over: { share?: ShareRecord; matter?: Matter; recipients?: ShareRecipientRecord[] } = {},
): ShareResolution => ({ status: 'matter_trashed', share: landingShare, matter: fileMatter, recipients: [], ...over })

function makeShareRepo(over: Partial<ShareRepo> = {}): ShareRepo {
  return {
    resolveByToken: async () => okResolution(),
    recordView: async () => {},
    hasDownloadsAvailable: async () => true,
    incrementDownloadsAtomic: async () => ({ ok: true, downloads: 3 }),
    decrementDownloads: async () => {},
    revokeByToken: async () => true,
    listForApi: async () => ({ items: [], total: 0 }),
    listReceivedForApi: async () => ({ items: [], total: 0 }),
    computeSourceBytes: async () => 1024,
    listDirectActiveChildren: async () => [],
    hasQuotaForBytes: async () => true,
    getCreatorName: async () => 'Creator Name',
    getUserEmail: async () => 'creator@example.com',
    getMatterName: async () => 'file.bin',
    findShareChildMatter: async () => childMatter,
    create: async () => landingShare,
    listRecipientUserIds: async () => [],
    cascadeDeleteByMatter: async () => {},
    ...over,
  } as ShareRepo
}

const emptyMatterList: MatterListResult = { items: [], total: 0, page: 1, pageSize: 50 }

function makeDeps(
  over: {
    share?: Partial<ShareRepo>
    matter?: Partial<MatterRepo>
    storages?: Partial<StorageRepo>
    s3?: Partial<S3Gateway>
    quota?: Partial<QuotaRepo>
    org?: Partial<OrgRepo>
  } = {},
) {
  const record = vi.fn(async () => {})
  const recordView = vi.fn(async () => {})
  const decrementDownloads = vi.fn(async () => {})
  const refundTraffic = vi.fn(async () => {})
  const presignDownload = vi.fn(async () => PRESIGNED_URL)
  // dispatchShareCreated now lives in this module, so its call cannot be mocked
  // at the module boundary; instead its collaborator ports are spies and the
  // createShare tests assert the observable fan-out (notification + email).
  const createNotification = vi.fn(async () => ({}) as never)
  const sendEmail = vi.fn(async () => {})
  const isEmailConfigured = vi.fn(async () => true)

  const deps = {
    share: makeShareRepo({ recordView, decrementDownloads, ...over.share }),
    matter: { list: async () => emptyMatterList, ...over.matter } as MatterRepo,
    storages: { get: async () => sampleStorage, ...over.storages } as StorageRepo,
    s3: { presignDownload, ...over.s3 } as S3Gateway,
    quota: { consumeTrafficIfQuotaAllows: async () => true, refundTraffic, ...over.quota } as QuotaRepo,
    org: { canWriteToOrg: async () => true, ...over.org } as OrgRepo,
    activity: { record } as unknown as ActivityRepo,
    notifications: { create: createNotification } as unknown as ShareDeps['notifications'],
    email: { isConfigured: isEmailConfigured, send: sendEmail } as unknown as ShareDeps['email'],
    shareNotifications: { getUserEmail: async () => null } as unknown as ShareDeps['shareNotifications'],
    // Cloud-metering ports are unused here — they are mocked.
    licenseBinding: {} as ShareDeps['licenseBinding'],
    licensingCloud: {} as ShareDeps['licensingCloud'],
    cloudTrafficReports: {} as ShareDeps['cloudTrafficReports'],
    storageUsage: {} as ShareDeps['storageUsage'],
  } as ShareDeps

  return {
    deps,
    record,
    recordView,
    decrementDownloads,
    refundTraffic,
    presignDownload,
    createNotification,
    sendEmail,
    isEmailConfigured,
  }
}

// dispatchShareCreated is launched fire-and-forget (.catch) by createShare;
// flush pending microtasks so its fan-out has run before asserting.
const flushDispatch = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  meter.mockResolvedValue(meterOk)
  saveToDrive.mockResolvedValue({ saved: [], skipped: [] })
})

// ─── viewShare ───────────────────────────────────────────────────────────────

describe('viewShare', () => {
  it('returns matter_trashed when the matter is trashed', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => trashedResolution() } })
    expectError(
      await viewShare(deps, { token: 't', viewerId: null, viewCookie: undefined, accessCookie: undefined }),
      410,
      undefined,
      'File no longer available',
    )
  })

  it('returns not_found for revoked/missing shares', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expectError(
      await viewShare(deps, { token: 't', viewerId: null, viewCookie: undefined, accessCookie: undefined }),
      404,
      undefined,
      'Share not found or revoked',
    )
  })

  it('hides a direct share from a non-creator (not_found)', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    const out = await viewShare(deps, {
      token: 't',
      viewerId: 'someone',
      viewCookie: undefined,
      accessCookie: undefined,
    })
    expectError(out, 404, undefined, 'Share not found or revoked')
  })

  it('returns the viewer DTO and signals the view cookie for an anonymous viewer', async () => {
    const { deps, recordView } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: undefined,
      accessCookie: undefined,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(true)
    expect(recordView).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        action: 'share_view',
        targetId: 's-1',
        metadata: expect.objectContaining({ bytes: 1024 }),
      }),
    )
    expect(out.dto).toMatchObject({
      token: 'sk_token1',
      kind: 'landing',
      matter: { name: 'file.bin', isFolder: false },
      creatorName: 'Creator Name',
      requiresPassword: false,
      expired: false,
      exhausted: false,
      accessibleByUser: false,
      rootRef: encodeChildRef('sk_token1', 'm-1'),
    })
    expect('recipients' in out.dto).toBe(false)
  })

  it('does not increment views (no cookie) when already seen', async () => {
    const { deps, recordView } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: 'seen',
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(false)
    expect(recordView).not.toHaveBeenCalled()
  })

  it('returns the richer creator DTO and never bumps views for the creator', async () => {
    const { deps, recordView } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: 'creator-1',
      viewCookie: undefined,
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(false)
    expect(recordView).not.toHaveBeenCalled()
    expect(out.dto).toMatchObject({
      id: 's-1',
      matterId: 'm-1',
      orgId: 'o-1',
      creatorId: 'creator-1',
      recipients: [],
    })
  })

  it('requiresPassword=true for a non-recipient viewer without the access cookie', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: 'x',
      viewCookie: 'seen',
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto.requiresPassword).toBe(true)
  })

  it('requiresPassword=false once the access cookie is ok', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const out = await viewShare(deps, { token: 'sk_token1', viewerId: null, viewCookie: 'seen', accessCookie: 'ok' })
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto.requiresPassword).toBe(false)
  })

  it('marks expired and exhausted from share state', async () => {
    const used = { ...landingShare, expiresAt: new Date('2000-01-01'), downloadLimit: 2, downloads: 2 } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: used }) } })
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: 'seen',
      accessCookie: undefined,
      now: new Date('2030-01-01'),
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto.expired).toBe(true)
    expect(out.dto.exhausted).toBe(true)
  })

  it('reports a folder matter as isFolder', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: folderMatter }) } })
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: 'seen',
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto.matter.isFolder).toBe(true)
  })
})

// ─── verifySharePassword ─────────────────────────────────────────────────────

describe('verifySharePassword', () => {
  it('returns not_found when the token does not resolve', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'not_found' }) } })
    expectError(
      await verifySharePassword(deps, { token: 't', password: 'x' }),
      404,
      undefined,
      'Share not found or revoked',
    )
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct', passwordHash: hashPassword('pw') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expectError(
      await verifySharePassword(deps, { token: 't', password: 'pw' }),
      404,
      undefined,
      'Share not found or revoked',
    )
  })

  it('returns invalid_password when the share has no password', async () => {
    const { deps } = makeDeps()
    expectError(await verifySharePassword(deps, { token: 't', password: 'pw' }), 403, undefined, 'Invalid password')
  })

  it('returns invalid_password on a wrong password', async () => {
    const pw = { ...landingShare, passwordHash: hashPassword('correct') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expectError(await verifySharePassword(deps, { token: 't', password: 'wrong' }), 403, undefined, 'Invalid password')
  })

  it('caps the cookie expiry at one day from now when no share expiry', async () => {
    const pw = { ...landingShare, passwordHash: hashPassword('correct'), expiresAt: null } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const now = new Date('2025-01-01T00:00:00Z')
    const out = await verifySharePassword(deps, { token: 't', password: 'correct', now })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setAccessCookieExpiry).toEqual(new Date('2025-01-02T00:00:00Z'))
  })

  it('clamps the cookie expiry to the share expiry when it is sooner than a day', async () => {
    const soon = new Date('2025-01-01T06:00:00Z')
    const pw = { ...landingShare, passwordHash: hashPassword('correct'), expiresAt: soon } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const out = await verifySharePassword(deps, {
      token: 't',
      password: 'correct',
      now: new Date('2025-01-01T00:00:00Z'),
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setAccessCookieExpiry).toEqual(soon)
  })
})

// ─── listShareObjects ────────────────────────────────────────────────────────

describe('listShareObjects', () => {
  const baseParams = { token: 'sk_token1', viewerId: null, accessCookie: 'ok', relativePath: '', page: 1, pageSize: 50 }

  it('returns matter_trashed / not_found from resolution', async () => {
    const trashed = makeDeps({ share: { resolveByToken: async () => trashedResolution() } })
    expectError(await listShareObjects(trashed.deps, baseParams), 410, undefined, 'File no longer available')

    const revoked = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expectError(await listShareObjects(revoked.deps, baseParams), 404, undefined, 'Share not found or revoked')
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: direct, matter: folderMatter }) },
    })
    expectError(await listShareObjects(deps, baseParams), 404, undefined, 'Share not found or revoked')
  })

  it('returns not_a_folder for a file share', async () => {
    const { deps } = makeDeps() // default matter is a file
    expectError(await listShareObjects(deps, baseParams), 400, undefined, 'Not a folder share')
  })

  it('returns password_required when the gate blocks', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: pw, matter: folderMatter }) },
    })
    expectError(
      await listShareObjects(deps, { ...baseParams, accessCookie: undefined }),
      401,
      undefined,
      'Password required',
    )
  })

  it('returns expired before checking the path', async () => {
    const expired = { ...landingShare, expiresAt: new Date('2000-01-01') } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: expired, matter: folderMatter }) },
    })
    expectError(
      await listShareObjects(deps, { ...baseParams, relativePath: '../etc', now: new Date('2030-01-01') }),
      410,
      undefined,
      'Share has expired',
    )
  })

  it('returns invalid_path for a traversal attempt', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: folderMatter }) } })
    expectError(await listShareObjects(deps, { ...baseParams, relativePath: 'a/../b' }), 400, undefined, 'Invalid path')
  })

  it('lists children, maps refs, and builds the breadcrumb at the folder root', async () => {
    const list = vi.fn(async () => ({
      items: [folderMatter, childMatter],
      total: 2,
      page: 1,
      pageSize: 50,
    }))
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ matter: folderMatter }) },
      matter: { list },
    })
    const out = await listShareObjects(deps, baseParams)
    if (!out.ok) throw new Error('expected ok')
    // folderMatter.parent='root', name='docs' → queryParent='root/docs'
    expect(list).toHaveBeenCalledWith('o-1', { parent: 'root/docs', page: 1, pageSize: 50 })
    expect(out.result.items).toEqual([
      { ref: encodeChildRef('sk_token1', 'fld-1'), name: 'docs', type: 'folder', size: 0, isFolder: true },
      {
        ref: encodeChildRef('sk_token1', 'm-child'),
        name: 'child.txt',
        type: fileMatter.type,
        size: 1024,
        isFolder: false,
      },
    ])
    expect(out.result.breadcrumb).toEqual([{ name: 'docs', path: '' }])
  })

  it('descends into a subfolder path and reflects it in the breadcrumb', async () => {
    const list = vi.fn(async () => emptyMatterList)
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ matter: folderMatter }) },
      matter: { list },
    })
    const out = await listShareObjects(deps, { ...baseParams, relativePath: 'a/b' })
    if (!out.ok) throw new Error('expected ok')
    expect(list).toHaveBeenCalledWith('o-1', { parent: 'root/docs/a/b', page: 1, pageSize: 50 })
    expect(out.result.breadcrumb).toEqual([
      { name: 'docs', path: '' },
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
    ])
  })
})

// ─── downloadShareObject ─────────────────────────────────────────────────────

describe('downloadShareObject', () => {
  const baseParams = {
    token: 'sk_token1',
    matterId: 'm-1',
    viewerId: null as string | null,
    accessCookie: 'ok' as string | undefined,
    cloudBaseUrl: CLOUD_BASE_URL,
  }

  it('presigns and returns the URL on the happy path (root file)', async () => {
    const { deps, presignDownload } = makeDeps()
    const out = await downloadShareObject(deps, baseParams)
    expect(out).toEqual({ ok: true, url: PRESIGNED_URL })
    expect(presignDownload).toHaveBeenCalledWith(sampleStorage, 'some/key.bin', 'file.bin', expect.any(Number))
  })

  it('passes cloudBaseUrl, source landing_share/sourceId, and a decrement onRejected to the meter', async () => {
    const { deps, decrementDownloads } = makeDeps()
    await downloadShareObject(deps, baseParams)
    expect(meter).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({
        cloudBaseUrl: CLOUD_BASE_URL,
        orgId: 'o-1',
        bytes: 1024,
        storage: sampleStorage,
        source: 'landing_share',
        sourceId: 's-1',
        onRejected: expect.any(Function),
      }),
    )
    const onRejected = meter.mock.calls[0][1].onRejected!
    await onRejected()
    expect(decrementDownloads).toHaveBeenCalledWith('s-1')
  })

  it('records a share_download activity attributed to the viewer', async () => {
    const { deps, record } = makeDeps()
    await downloadShareObject(deps, { ...baseParams, viewerId: 'viewer-9' })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'o-1',
        userId: 'viewer-9',
        actorType: 'user',
        action: 'share_download',
        targetId: 's-1',
        targetName: 'file.bin',
        metadata: expect.objectContaining({ anonymous: false, source: 'landing_share', status: 'issued', bytes: 1024 }),
      }),
    )
  })

  it('records anonymous downloads without attributing them to the creator', async () => {
    const { deps, record } = makeDeps()
    await downloadShareObject(deps, { ...baseParams, viewerId: null })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        actorType: 'anonymous',
        metadata: expect.objectContaining({ anonymous: true, creatorId: 'creator-1', source: 'landing_share' }),
      }),
    )
  })

  it('fails when the activity record throws', async () => {
    const record = vi.fn(async () => {
      throw new Error('audit down')
    })
    const { deps } = makeDeps()
    deps.activity = { record } as unknown as ActivityRepo
    await expect(downloadShareObject(deps, baseParams)).rejects.toThrow('audit down')
  })

  it('returns matter_trashed / not_found from resolution', async () => {
    const trashed = makeDeps({ share: { resolveByToken: async () => trashedResolution() } })
    expectError(await downloadShareObject(trashed.deps, baseParams), 410, undefined, 'File no longer available')
    const revoked = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expectError(await downloadShareObject(revoked.deps, baseParams), 404, undefined, 'File not found or not accessible')
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expectError(await downloadShareObject(deps, baseParams), 404, undefined, 'File not found or not accessible')
  })

  it('returns invalid_ref when the decoded matterId is null', async () => {
    const { deps } = makeDeps()
    expectError(await downloadShareObject(deps, { ...baseParams, matterId: null }), 400, undefined, 'Invalid reference')
  })

  it('returns password_required when the gate blocks', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expectError(
      await downloadShareObject(deps, { ...baseParams, accessCookie: undefined }),
      401,
      undefined,
      'Password required',
    )
  })

  it('returns expired when past the share expiry', async () => {
    const expired = { ...landingShare, expiresAt: new Date('2000-01-01') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: expired }) } })
    expectError(await downloadShareObject(deps, baseParams), 410, undefined, 'Share has expired')
  })

  it('resolves a descendant ref via findShareChildMatter', async () => {
    const findShareChildMatter = vi.fn(async () => childMatter)
    const { deps, presignDownload } = makeDeps({
      share: { resolveByToken: async () => okResolution({ matter: folderMatter }), findShareChildMatter },
    })
    const out = await downloadShareObject(deps, { ...baseParams, matterId: 'm-child' })
    expect(out).toEqual({ ok: true, url: PRESIGNED_URL })
    expect(findShareChildMatter).toHaveBeenCalledWith(folderMatter, 'm-child')
    expect(presignDownload).toHaveBeenCalledWith(sampleStorage, childMatter.object, 'child.txt', expect.any(Number))
  })

  it('returns not_found when a descendant ref targets a file share root', async () => {
    const { deps } = makeDeps() // root is a file
    expectError(
      await downloadShareObject(deps, { ...baseParams, matterId: 'other' }),
      404,
      undefined,
      'File not found or not accessible',
    )
  })

  it('returns not_found when the descendant child is missing', async () => {
    const { deps } = makeDeps({
      share: {
        resolveByToken: async () => okResolution({ matter: folderMatter }),
        findShareChildMatter: async () => null,
      },
    })
    expectError(
      await downloadShareObject(deps, { ...baseParams, matterId: 'm-child' }),
      404,
      undefined,
      'File not found or not accessible',
    )
  })

  it('returns folder when the root itself is a folder requested directly', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: folderMatter }) } })
    expectError(
      await downloadShareObject(deps, { ...baseParams, matterId: 'fld-1' }),
      400,
      undefined,
      'Cannot download a folder directly',
    )
  })

  it('returns limit_exceeded when no downloads remain', async () => {
    const { deps, presignDownload } = makeDeps({ share: { hasDownloadsAvailable: async () => false } })
    expectError(await downloadShareObject(deps, baseParams), 410, undefined, 'Download limit exceeded')
    expect(presignDownload).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  it('returns limit_exceeded when the atomic increment loses the race', async () => {
    const { deps, presignDownload } = makeDeps({
      share: { incrementDownloadsAtomic: async () => ({ ok: false, downloads: 0 }) },
    })
    expectError(await downloadShareObject(deps, baseParams), 410, undefined, 'Download limit exceeded')
    expect(presignDownload).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  it('returns storage_not_found when the storage is missing', async () => {
    const { deps } = makeDeps({ storages: { get: async () => null } })
    expectError(await downloadShareObject(deps, baseParams), 404, undefined, 'Storage not found')
  })

  it('returns quota_exceeded when the meter rejects on quota; presign never runs', async () => {
    meter.mockResolvedValue(meterQuotaExceeded)
    const { deps, presignDownload } = makeDeps()
    expectError(await downloadShareObject(deps, baseParams), 422, 'QUOTA_EXCEEDED', 'Traffic quota exceeded')
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('returns insufficient_credits when the meter rejects on credits', async () => {
    meter.mockResolvedValue(meterInsufficientCredits)
    const { deps, presignDownload } = makeDeps()
    expectError(await downloadShareObject(deps, baseParams), 402, 'INSUFFICIENT_CREDITS', 'Insufficient credits')
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('refunds traffic AND decrements the download when presign fails, then rethrows', async () => {
    const presignDownload = vi.fn(async () => {
      throw new Error('sign failed')
    })
    const { deps, refundTraffic, decrementDownloads } = makeDeps({ s3: { presignDownload } })
    await expect(downloadShareObject(deps, baseParams)).rejects.toThrow('sign failed')
    expect(refundTraffic).toHaveBeenCalledWith('o-1', 1024)
    expect(decrementDownloads).toHaveBeenCalledWith('s-1')
  })

  it('meters bytes=0 when the matter has no size', async () => {
    const sizeless = { ...fileMatter, size: null } as Matter
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: sizeless }) } })
    await downloadShareObject(deps, baseParams)
    expect(meter).toHaveBeenCalledWith(deps, expect.objectContaining({ bytes: 0 }))
  })
})

// ─── listShares ──────────────────────────────────────────────────────────────

describe('listShares', () => {
  const sentItem = { id: 's-1', token: 'sk_token1' } as ShareListItem

  it('lists the sent box via listForApi with status', async () => {
    const listForApi = vi.fn(async () => ({ items: [sentItem], total: 1 }))
    const { deps } = makeDeps({ share: { listForApi } })
    const out = await listShares(deps, { userId: 'u1', box: 'sent', page: 2, pageSize: 10, status: 'active' })
    expect(listForApi).toHaveBeenCalledWith('u1', { page: 2, pageSize: 10, status: 'active' })
    expect(out).toEqual({ items: [sentItem], total: 1, page: 2, pageSize: 10 })
  })

  it('defaults to the sent box when box is undefined', async () => {
    const listForApi = vi.fn(async () => ({ items: [], total: 0 }))
    const listReceivedForApi = vi.fn(async () => ({ items: [], total: 0 }))
    const { deps } = makeDeps({ share: { listForApi, listReceivedForApi } })
    await listShares(deps, { userId: 'u1', box: undefined, page: 1, pageSize: 20 })
    expect(listForApi).toHaveBeenCalled()
    expect(listReceivedForApi).not.toHaveBeenCalled()
  })

  it('lists the received box via listReceivedForApi, threading the user email', async () => {
    const getUserEmail = vi.fn(async () => 'me@example.com')
    const listReceivedForApi = vi.fn(async () => ({ items: [sentItem], total: 1 }))
    const { deps } = makeDeps({ share: { getUserEmail, listReceivedForApi } })
    const out = await listShares(deps, { userId: 'u1', box: 'received', page: 1, pageSize: 20 })
    expect(getUserEmail).toHaveBeenCalledWith('u1')
    expect(listReceivedForApi).toHaveBeenCalledWith('u1', 'me@example.com', { page: 1, pageSize: 20 })
    expect(out).toEqual({ items: [sentItem], total: 1, page: 1, pageSize: 20 })
  })
})

// ─── createShare ─────────────────────────────────────────────────────────────

describe('createShare', () => {
  const baseInput = { matterId: 'm-1', kind: 'landing' as const }

  it('creates the share, records activity, and returns the wire DTO', async () => {
    const create = vi.fn(async () => landingShare)
    const { deps, record } = makeDeps({ share: { create, getMatterName: async () => 'file.bin' } })
    const out = await createShare(deps, platform, {
      orgId: 'o-1',
      userId: 'creator-1',
      input: { ...baseInput, password: 'pw', expiresAt: '2030-01-01T00:00:00Z', downloadLimit: 5 },
    })
    expect(out).toEqual({
      ok: true,
      share: { token: 'sk_token1', kind: 'landing', expiresAt: null, downloadLimit: null },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        matterId: 'm-1',
        orgId: 'o-1',
        creatorId: 'creator-1',
        kind: 'landing',
        password: 'pw',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        downloadLimit: 5,
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'share_create',
        targetId: 's-1',
        targetName: 'file.bin',
        metadata: { kind: 'landing', hasPassword: true, hasExpiry: true },
      }),
    )
  })

  it('does not dispatch notifications when there are no recipients', async () => {
    const { deps, createNotification, sendEmail } = makeDeps()
    await createShare(deps, platform, { orgId: 'o-1', userId: 'creator-1', input: baseInput })
    await flushDispatch()
    expect(createNotification).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('dispatches share-created notifications when recipients are present', async () => {
    const { deps, createNotification, sendEmail } = makeDeps({
      share: { getCreatorName: async () => 'Alice', getMatterName: async () => 'doc.pdf' },
    })
    const recipients = [{ recipientUserId: 'u2' }, { recipientEmail: 'b@example.com' }]
    await createShare(deps, platform, {
      orgId: 'o-1',
      userId: 'creator-1',
      input: { ...baseInput, recipients },
    })
    await flushDispatch()
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u2',
        type: 'share_received',
        title: 'Alice shared "doc.pdf" with you',
        refId: 's-1',
      }),
    )
    expect(sendEmail).toHaveBeenCalledWith(
      platform,
      expect.objectContaining({ to: 'b@example.com', subject: 'Alice shared "doc.pdf" with you' }),
    )
  })

  it('falls back to Unknown creator / empty matter name', async () => {
    const { deps, record, sendEmail } = makeDeps({
      share: { getCreatorName: async () => null, getMatterName: async () => null },
    })
    await createShare(deps, platform, {
      orgId: 'o-1',
      userId: 'creator-1',
      input: { ...baseInput, recipients: [{ recipientEmail: 'b@example.com' }] },
    })
    await flushDispatch()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: '' }))
    expect(sendEmail).toHaveBeenCalledWith(
      platform,
      expect.objectContaining({ to: 'b@example.com', subject: 'Unknown shared "" with you' }),
    )
  })

  it.each([
    ['MATTER_NOT_FOUND', 404, 'Matter not found'],
    ['DIRECT_NO_FOLDER', 400, 'Direct shares cannot be folders'],
    ['DIRECT_NO_PASSWORD', 400, 'Direct shares cannot have a password'],
    ['DIRECT_NO_RECIPIENTS', 400, 'Direct shares cannot have recipients'],
  ] as const)('maps CreateShareError %s to a failure outcome without recording activity', async (code, status, message) => {
    const create = vi.fn(async () => {
      throw new CreateShareError(code)
    })
    const { deps, record, createNotification, sendEmail } = makeDeps({ share: { create } })
    const out = await createShare(deps, platform, { orgId: 'o-1', userId: 'creator-1', input: baseInput })
    expectError(out, status, code, message)
    expect(record).not.toHaveBeenCalled()
    await flushDispatch()
    expect(createNotification).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rethrows a non-CreateShareError', async () => {
    const create = vi.fn(async () => {
      throw new Error('db down')
    })
    const { deps } = makeDeps({ share: { create } })
    await expect(createShare(deps, platform, { orgId: 'o-1', userId: 'creator-1', input: baseInput })).rejects.toThrow(
      'db down',
    )
  })
})

// ─── revokeShare ─────────────────────────────────────────────────────────────

describe('revokeShare', () => {
  it('returns not_found when the token does not resolve', async () => {
    const { deps, record } = makeDeps({ share: { resolveByToken: async () => ({ status: 'not_found' }) } })
    expectError(await revokeShare(deps, { token: 't', userId: 'creator-1', orgId: 'o-1' }), 404, undefined, 'Not found')
    expect(record).not.toHaveBeenCalled()
  })

  it('returns not_found when the share is already revoked', async () => {
    const { deps, record } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expectError(await revokeShare(deps, { token: 't', userId: 'creator-1', orgId: 'o-1' }), 404, undefined, 'Not found')
    expect(record).not.toHaveBeenCalled()
  })

  it('returns forbidden when the requester is not the creator', async () => {
    const { deps } = makeDeps()
    expectError(
      await revokeShare(deps, { token: 't', userId: 'someone-else', orgId: 'o-1' }),
      403,
      undefined,
      'Forbidden',
    )
  })

  it('returns not_found when the scoped revoke loses the race', async () => {
    const { deps } = makeDeps({ share: { revokeByToken: async () => false } })
    expectError(
      await revokeShare(deps, { token: 'sk_token1', userId: 'creator-1', orgId: 'o-1' }),
      404,
      undefined,
      'Not found',
    )
  })

  it('still revokes a share whose matter is trashed (trashing does not cascade)', async () => {
    const revokeByToken = vi.fn(async () => true)
    const { deps, record } = makeDeps({ share: { resolveByToken: async () => trashedResolution(), revokeByToken } })
    const out = await revokeShare(deps, { token: 'sk_token1', userId: 'creator-1', orgId: 'o-1' })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto).toMatchObject({ token: 'sk_token1', status: 'revoked', id: 's-1', creatorId: 'creator-1' })
    expect(revokeByToken).toHaveBeenCalledWith('sk_token1', 'creator-1')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'share_revoke', targetName: 'sk_token1' }))
  })

  it('returns forbidden for a non-creator even when the matter is trashed', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => trashedResolution() } })
    expectError(
      await revokeShare(deps, { token: 'sk_token1', userId: 'someone-else', orgId: 'o-1' }),
      403,
      undefined,
      'Forbidden',
    )
  })

  it('revokes, records activity, and returns the revoked creator view', async () => {
    const revokeByToken = vi.fn(async () => true)
    const { deps, record } = makeDeps({ share: { revokeByToken } })
    const out = await revokeShare(deps, { token: 'sk_token1', userId: 'creator-1', orgId: 'o-1' })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected ok')
    expect(out.dto).toMatchObject({
      token: 'sk_token1',
      status: 'revoked',
      id: 's-1',
      creatorId: 'creator-1',
      recipients: [],
    })
    expect(revokeByToken).toHaveBeenCalledWith('sk_token1', 'creator-1')
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'share_revoke', targetName: 'sk_token1', orgId: 'o-1', userId: 'creator-1' }),
    )
  })
})

// ─── saveShare ───────────────────────────────────────────────────────────────

describe('saveShare', () => {
  const baseParams = {
    token: 'sk_token1',
    currentUserId: 'u1',
    targetOrgId: 'o-2',
    targetParent: '',
    accessCookie: undefined,
  }

  it('returns matter_trashed when the share target was trashed', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => trashedResolution() } })
    expectError(await saveShare(deps, baseParams), 410, undefined, 'Share target has been deleted')
  })

  it('returns not_found for a revoked/missing share', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expectError(await saveShare(deps, baseParams), 404, undefined, 'Share not found')
  })

  it('returns direct_forbidden for a direct share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expectError(
      await saveShare(deps, baseParams),
      400,
      'DIRECT_SAVE_FORBIDDEN',
      'Direct link shares cannot be saved. Ask the sender for a landing share.',
    )
  })

  it('returns password_required when the gate blocks a non-recipient', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expectError(
      await saveShare(deps, { ...baseParams, accessCookie: undefined }),
      401,
      undefined,
      'Authentication required for password-protected share',
    )
  })

  it('bypasses the password gate when the cookie is ok', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const out = await saveShare(deps, { ...baseParams, accessCookie: 'ok' })
    expect(out.ok).toBe(true)
  })

  it('returns forbidden when the user cannot write to the target org', async () => {
    const { deps } = makeDeps({ org: { canWriteToOrg: async () => false } })
    expectError(await saveShare(deps, baseParams), 403, undefined, 'Forbidden')
  })

  it('returns quota_exceeded when the target org lacks quota', async () => {
    const computeSourceBytes = vi.fn(async () => 5000)
    const hasQuotaForBytes = vi.fn(async () => false)
    const { deps } = makeDeps({ share: { computeSourceBytes, hasQuotaForBytes } })
    expectError(await saveShare(deps, baseParams), 422, 'QUOTA_EXCEEDED', 'Quota exceeded')
    expect(hasQuotaForBytes).toHaveBeenCalledWith('o-2', 5000)
    expect(saveToDrive).not.toHaveBeenCalled()
  })

  it('copies via saveShareToDrive and returns the result on success', async () => {
    const saved = [{ ...fileMatter, id: 'copy-1' }] as Matter[]
    saveToDrive.mockResolvedValue({ saved, skipped: [{ name: 'x', reason: 'quota' }] })
    const { deps } = makeDeps()
    const out = await saveShare(deps, { ...baseParams, targetParent: 'dest' })
    expect(out).toEqual({ ok: true, result: { saved, skipped: [{ name: 'x', reason: 'quota' }] } })
    expect(saveToDrive).toHaveBeenCalledWith(deps, {
      share: landingShare,
      matter: fileMatter,
      currentUserId: 'u1',
      targetOrgId: 'o-2',
      targetParent: 'dest',
    })
  })
})
