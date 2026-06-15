import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeChildRef } from '../http/share-utils'
import { hashPassword } from '../lib/password'
import type { Platform } from '../platform/interface'
import { type DownloadTrafficOutcome, meterDownloadTraffic } from './cloud-traffic-metering'
import {
  type ActivityRepo,
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
import { saveShareToDrive } from './save-to-drive'
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
import { dispatchShareCreated } from './share-notification'

// The end-to-end metering (quota consume → cloud egress report → refund) is
// covered by cloud-traffic-metering.test.ts; the recipient fan-out and the copy
// engine by share-notification/save-to-drive tests. Here we replace those three
// collaborators with mocks so each share case feeds a chosen outcome and we can
// assert the share routes' gates, ordering, DTO shaping, and presign-rollback in
// isolation. Everything else (types, pure helpers) stays real.
vi.mock('./cloud-traffic-metering', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./cloud-traffic-metering')>()),
  meterDownloadTraffic: vi.fn(),
}))
vi.mock('./save-to-drive', () => ({ saveShareToDrive: vi.fn() }))
vi.mock('./share-notification', () => ({ dispatchShareCreated: vi.fn() }))

const PRESIGNED_URL = 'https://presigned.example.com/file'
const CLOUD_BASE_URL = 'https://cloud.example.com'

const meterOk: DownloadTrafficOutcome = { ok: true }
const meterQuotaExceeded: DownloadTrafficOutcome = { ok: false, reason: 'quota_exceeded' }
const meterInsufficientCredits: DownloadTrafficOutcome = { ok: false, reason: 'insufficient_credits' }

const meter = vi.mocked(meterDownloadTraffic)
const saveToDrive = vi.mocked(saveShareToDrive)
const dispatch = vi.mocked(dispatchShareCreated)

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

function makeShareRepo(over: Partial<ShareRepo> = {}): ShareRepo {
  return {
    resolveByToken: async () => okResolution(),
    incrementViews: async () => {},
    hasDownloadsAvailable: async () => true,
    incrementDownloadsAtomic: async () => ({ ok: true, downloads: 3 }),
    decrementDownloads: async () => {},
    getCreatorByToken: async () => 'creator-1',
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
  const incrementViews = vi.fn(async () => {})
  const decrementDownloads = vi.fn(async () => {})
  const refundTraffic = vi.fn(async () => {})
  const presignDownload = vi.fn(async () => PRESIGNED_URL)

  const deps = {
    share: makeShareRepo({ incrementViews, decrementDownloads, ...over.share }),
    matter: { list: async () => emptyMatterList, ...over.matter } as MatterRepo,
    storages: { get: async () => sampleStorage, ...over.storages } as StorageRepo,
    s3: { presignDownload, ...over.s3 } as S3Gateway,
    quota: { consumeTrafficIfQuotaAllows: async () => true, refundTraffic, ...over.quota } as QuotaRepo,
    org: { canWriteToOrg: async () => true, ...over.org } as OrgRepo,
    activity: { record } as unknown as ActivityRepo,
    // Cloud-metering + collaborator ports are unused here — they are mocked.
    licenseBinding: {} as ShareDeps['licenseBinding'],
    licensingCloud: {} as ShareDeps['licensingCloud'],
    cloudTrafficReports: {} as ShareDeps['cloudTrafficReports'],
    notifications: {} as ShareDeps['notifications'],
    email: {} as ShareDeps['email'],
    shareNotifications: {} as ShareDeps['shareNotifications'],
    storageUsage: {} as ShareDeps['storageUsage'],
  } as ShareDeps

  return { deps, record, incrementViews, decrementDownloads, refundTraffic, presignDownload }
}

beforeEach(() => {
  vi.clearAllMocks()
  meter.mockResolvedValue(meterOk)
  saveToDrive.mockResolvedValue({ saved: [], skipped: [] })
  dispatch.mockResolvedValue(undefined)
})

// ─── viewShare ───────────────────────────────────────────────────────────────

describe('viewShare', () => {
  it('returns matter_trashed when the matter is trashed', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'matter_trashed' }) } })
    expect(
      await viewShare(deps, { token: 't', viewerId: null, viewCookie: undefined, accessCookie: undefined }),
    ).toEqual({ ok: false, reason: 'matter_trashed' })
  })

  it('returns not_found for revoked/missing shares', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expect(
      await viewShare(deps, { token: 't', viewerId: null, viewCookie: undefined, accessCookie: undefined }),
    ).toEqual({ ok: false, reason: 'not_found' })
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
    expect(out).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns the viewer DTO and signals the view cookie for an anonymous viewer', async () => {
    const { deps, incrementViews } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: undefined,
      accessCookie: undefined,
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(true)
    expect(incrementViews).toHaveBeenCalledWith('s-1')
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
    const { deps, incrementViews } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: null,
      viewCookie: 'seen',
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(false)
    expect(incrementViews).not.toHaveBeenCalled()
  })

  it('returns the richer creator DTO and never bumps views for the creator', async () => {
    const { deps, incrementViews } = makeDeps()
    const out = await viewShare(deps, {
      token: 'sk_token1',
      viewerId: 'creator-1',
      viewCookie: undefined,
      accessCookie: undefined,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.setViewCookie).toBe(false)
    expect(incrementViews).not.toHaveBeenCalled()
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
    expect(await verifySharePassword(deps, { token: 't', password: 'x' })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct', passwordHash: hashPassword('pw') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expect(await verifySharePassword(deps, { token: 't', password: 'pw' })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns invalid_password when the share has no password', async () => {
    const { deps } = makeDeps()
    expect(await verifySharePassword(deps, { token: 't', password: 'pw' })).toEqual({
      ok: false,
      reason: 'invalid_password',
    })
  })

  it('returns invalid_password on a wrong password', async () => {
    const pw = { ...landingShare, passwordHash: hashPassword('correct') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expect(await verifySharePassword(deps, { token: 't', password: 'wrong' })).toEqual({
      ok: false,
      reason: 'invalid_password',
    })
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
    const trashed = makeDeps({ share: { resolveByToken: async () => ({ status: 'matter_trashed' }) } })
    expect(await listShareObjects(trashed.deps, baseParams)).toEqual({ ok: false, reason: 'matter_trashed' })

    const revoked = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expect(await listShareObjects(revoked.deps, baseParams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: direct, matter: folderMatter }) },
    })
    expect(await listShareObjects(deps, baseParams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_a_folder for a file share', async () => {
    const { deps } = makeDeps() // default matter is a file
    expect(await listShareObjects(deps, baseParams)).toEqual({ ok: false, reason: 'not_a_folder' })
  })

  it('returns password_required when the gate blocks', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: pw, matter: folderMatter }) },
    })
    expect(await listShareObjects(deps, { ...baseParams, accessCookie: undefined })).toEqual({
      ok: false,
      reason: 'password_required',
    })
  })

  it('returns expired before checking the path', async () => {
    const expired = { ...landingShare, expiresAt: new Date('2000-01-01') } as ShareRecord
    const { deps } = makeDeps({
      share: { resolveByToken: async () => okResolution({ share: expired, matter: folderMatter }) },
    })
    expect(
      await listShareObjects(deps, { ...baseParams, relativePath: '../etc', now: new Date('2030-01-01') }),
    ).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('returns invalid_path for a traversal attempt', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: folderMatter }) } })
    expect(await listShareObjects(deps, { ...baseParams, relativePath: 'a/../b' })).toEqual({
      ok: false,
      reason: 'invalid_path',
    })
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
    expect(list).toHaveBeenCalledWith('o-1', { parent: 'root/docs', status: 'active', page: 1, pageSize: 50 })
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
    expect(list).toHaveBeenCalledWith('o-1', { parent: 'root/docs/a/b', status: 'active', page: 1, pageSize: 50 })
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
        action: 'share_download',
        targetId: 's-1',
        targetName: 'file.bin',
        metadata: { anonymous: false },
      }),
    )
  })

  it('attributes anonymous downloads to the creator', async () => {
    const { deps, record } = makeDeps()
    await downloadShareObject(deps, { ...baseParams, viewerId: null })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ userId: 'creator-1', metadata: { anonymous: true } }))
  })

  it('still succeeds when the activity record throws', async () => {
    const record = vi.fn(async () => {
      throw new Error('audit down')
    })
    const { deps } = makeDeps()
    deps.activity = { record } as unknown as ActivityRepo
    const out = await downloadShareObject(deps, baseParams)
    expect(out).toEqual({ ok: true, url: PRESIGNED_URL })
  })

  it('returns matter_trashed / not_found from resolution', async () => {
    const trashed = makeDeps({ share: { resolveByToken: async () => ({ status: 'matter_trashed' }) } })
    expect(await downloadShareObject(trashed.deps, baseParams)).toEqual({ ok: false, reason: 'matter_trashed' })
    const revoked = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expect(await downloadShareObject(revoked.deps, baseParams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns not_found for a non-landing share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns invalid_ref when the decoded matterId is null', async () => {
    const { deps } = makeDeps()
    expect(await downloadShareObject(deps, { ...baseParams, matterId: null })).toEqual({
      ok: false,
      reason: 'invalid_ref',
    })
  })

  it('returns password_required when the gate blocks', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expect(await downloadShareObject(deps, { ...baseParams, accessCookie: undefined })).toEqual({
      ok: false,
      reason: 'password_required',
    })
  })

  it('returns expired when past the share expiry', async () => {
    const expired = { ...landingShare, expiresAt: new Date('2000-01-01') } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: expired }) } })
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'expired' })
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
    expect(await downloadShareObject(deps, { ...baseParams, matterId: 'other' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('returns not_found when the descendant child is missing', async () => {
    const { deps } = makeDeps({
      share: {
        resolveByToken: async () => okResolution({ matter: folderMatter }),
        findShareChildMatter: async () => null,
      },
    })
    expect(await downloadShareObject(deps, { ...baseParams, matterId: 'm-child' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('returns folder when the root itself is a folder requested directly', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ matter: folderMatter }) } })
    expect(await downloadShareObject(deps, { ...baseParams, matterId: 'fld-1' })).toEqual({
      ok: false,
      reason: 'folder',
    })
  })

  it('returns limit_exceeded when no downloads remain', async () => {
    const { deps, presignDownload } = makeDeps({ share: { hasDownloadsAvailable: async () => false } })
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'limit_exceeded' })
    expect(presignDownload).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  it('returns limit_exceeded when the atomic increment loses the race', async () => {
    const { deps, presignDownload } = makeDeps({
      share: { incrementDownloadsAtomic: async () => ({ ok: false, downloads: 0 }) },
    })
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'limit_exceeded' })
    expect(presignDownload).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  it('returns storage_not_found when the storage is missing', async () => {
    const { deps } = makeDeps({ storages: { get: async () => null } })
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'storage_not_found' })
  })

  it('returns quota_exceeded when the meter rejects on quota; presign never runs', async () => {
    meter.mockResolvedValue(meterQuotaExceeded)
    const { deps, presignDownload } = makeDeps()
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'quota_exceeded' })
    expect(presignDownload).not.toHaveBeenCalled()
  })

  it('returns insufficient_credits when the meter rejects on credits', async () => {
    meter.mockResolvedValue(meterInsufficientCredits)
    const { deps, presignDownload } = makeDeps()
    expect(await downloadShareObject(deps, baseParams)).toEqual({ ok: false, reason: 'insufficient_credits' })
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
    const { deps } = makeDeps()
    await createShare(deps, platform, { orgId: 'o-1', userId: 'creator-1', input: baseInput })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('dispatches share-created notifications when recipients are present', async () => {
    const { deps } = makeDeps({ share: { getCreatorName: async () => 'Alice', getMatterName: async () => 'doc.pdf' } })
    const recipients = [{ recipientUserId: 'u2' }, { recipientEmail: 'b@example.com' }]
    await createShare(deps, platform, {
      orgId: 'o-1',
      userId: 'creator-1',
      input: { ...baseInput, recipients },
    })
    expect(dispatch).toHaveBeenCalledWith(
      deps,
      platform,
      { id: 's-1', token: 'sk_token1', kind: 'landing', expiresAt: null },
      recipients,
      'Alice',
      'doc.pdf',
    )
  })

  it('falls back to Unknown creator / empty matter name', async () => {
    const { deps, record } = makeDeps({
      share: { getCreatorName: async () => null, getMatterName: async () => null },
    })
    await createShare(deps, platform, {
      orgId: 'o-1',
      userId: 'creator-1',
      input: { ...baseInput, recipients: [{ recipientEmail: 'b@example.com' }] },
    })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: '' }))
    expect(dispatch).toHaveBeenCalledWith(deps, platform, expect.anything(), expect.anything(), 'Unknown', '')
  })

  it.each([
    ['MATTER_NOT_FOUND'],
    ['DIRECT_NO_FOLDER'],
    ['DIRECT_NO_PASSWORD'],
    ['DIRECT_NO_RECIPIENTS'],
  ] as const)('maps CreateShareError %s to a failure outcome without recording activity', async (code) => {
    const create = vi.fn(async () => {
      throw new CreateShareError(code)
    })
    const { deps, record } = makeDeps({ share: { create } })
    const out = await createShare(deps, platform, { orgId: 'o-1', userId: 'creator-1', input: baseInput })
    expect(out).toEqual({ ok: false, reason: code })
    expect(record).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
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
  it('returns not_found when the token has no creator', async () => {
    const { deps, record } = makeDeps({ share: { getCreatorByToken: async () => null } })
    expect(await revokeShare(deps, { token: 't', userId: 'u1', orgId: 'o-1' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    expect(record).not.toHaveBeenCalled()
  })

  it('returns forbidden when the requester is not the creator', async () => {
    const { deps } = makeDeps({ share: { getCreatorByToken: async () => 'someone-else' } })
    expect(await revokeShare(deps, { token: 't', userId: 'u1', orgId: 'o-1' })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
  })

  it('returns not_found when the scoped revoke loses the race', async () => {
    const { deps } = makeDeps({ share: { getCreatorByToken: async () => 'u1', revokeByToken: async () => false } })
    expect(await revokeShare(deps, { token: 't', userId: 'u1', orgId: 'o-1' })).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })

  it('revokes and records activity on success', async () => {
    const revokeByToken = vi.fn(async () => true)
    const { deps, record } = makeDeps({ share: { getCreatorByToken: async () => 'u1', revokeByToken } })
    expect(await revokeShare(deps, { token: 'tok', userId: 'u1', orgId: 'o-1' })).toEqual({ ok: true })
    expect(revokeByToken).toHaveBeenCalledWith('tok', 'u1')
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'share_revoke', targetName: 'tok', orgId: 'o-1', userId: 'u1' }),
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
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'matter_trashed' }) } })
    expect(await saveShare(deps, baseParams)).toEqual({ ok: false, reason: 'matter_trashed' })
  })

  it('returns not_found for a revoked/missing share', async () => {
    const { deps } = makeDeps({ share: { resolveByToken: async () => ({ status: 'revoked' }) } })
    expect(await saveShare(deps, baseParams)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('returns direct_forbidden for a direct share', async () => {
    const direct = { ...landingShare, kind: 'direct' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: direct }) } })
    expect(await saveShare(deps, baseParams)).toEqual({ ok: false, reason: 'direct_forbidden' })
  })

  it('returns password_required when the gate blocks a non-recipient', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    expect(await saveShare(deps, { ...baseParams, accessCookie: undefined })).toEqual({
      ok: false,
      reason: 'password_required',
    })
  })

  it('bypasses the password gate when the cookie is ok', async () => {
    const pw = { ...landingShare, passwordHash: 'hash' } as ShareRecord
    const { deps } = makeDeps({ share: { resolveByToken: async () => okResolution({ share: pw }) } })
    const out = await saveShare(deps, { ...baseParams, accessCookie: 'ok' })
    expect(out.ok).toBe(true)
  })

  it('returns forbidden when the user cannot write to the target org', async () => {
    const { deps } = makeDeps({ org: { canWriteToOrg: async () => false } })
    expect(await saveShare(deps, baseParams)).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('returns quota_exceeded when the target org lacks quota', async () => {
    const computeSourceBytes = vi.fn(async () => 5000)
    const hasQuotaForBytes = vi.fn(async () => false)
    const { deps } = makeDeps({ share: { computeSourceBytes, hasQuotaForBytes } })
    expect(await saveShare(deps, baseParams)).toEqual({ ok: false, reason: 'quota_exceeded' })
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
