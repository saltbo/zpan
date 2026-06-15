import { DirType } from '@shared/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { meterDownloadTraffic } from './cloud-traffic-metering'
import {
  authorizeTaskUploadConfirm,
  cancelObject,
  confirmObject,
  copyObject,
  createObject,
  createUploadSession,
  deleteObject,
  getObject,
  hasEditorAccess,
  listObjects,
  type ObjectActor,
  ObjectUploadSessionError,
  restoreObject,
  transferObject,
  trashObject,
  updateObject,
} from './object'
import type {
  ActivityRepo,
  CloudTrafficReportRepo,
  ConflictPlan,
  DownloaderRepo,
  DownloadTaskRecord,
  DownloadTaskRepo,
  LicenseBindingRepo,
  LicensingCloudGateway,
  Matter,
  MatterRepo,
  ObjectUploadSessionRecord,
  ObjectUploadSessionRepo,
  OrgRepo,
  QuotaRepo,
  S3Gateway,
  ShareRepo,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
} from './ports'

// Download metering is an end-to-end usecase of its own (quota + cloud report +
// refund); object.getObject only orchestrates around it. Mock it and assert the
// outcome mapping + presign rollback here; cloud-traffic-metering.test.ts owns
// the metering internals.
vi.mock('./cloud-traffic-metering', () => ({ meterDownloadTraffic: vi.fn() }))

const storage = {
  id: 'st-1',
  title: 'S3',
  mode: 'private',
  egressCreditBillingEnabled: false,
  egressCreditUnitBytes: 0,
  egressCreditPerUnit: 0,
} as unknown as StorageRecord

// Fixed so two file() calls compare equal (tests deep-equal a fixture against a
// usecase result; argless new Date() per call would flake under load).
const FIXED_DATE = new Date('2024-01-01T00:00:00.000Z')

function file(id: string, overrides: Partial<Matter> = {}): Matter {
  return {
    id,
    orgId: 'o1',
    alias: `${id}-alias`,
    name: `${id}.txt`,
    type: 'text/plain',
    size: 100,
    dirtype: DirType.FILE,
    parent: '',
    object: `key/${id}`,
    storageId: 'st-1',
    status: 'active',
    trashedAt: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  }
}

const folder = (id: string, overrides: Partial<Matter> = {}): Matter =>
  file(id, { dirtype: DirType.USER_FOLDER, size: 0, object: '', ...overrides })

const user: ObjectActor = { kind: 'user', userId: 'u1' }

// A permissive default deps; tests override only the ports they exercise.
function makeDeps(
  overrides: {
    matter?: Partial<MatterRepo>
    storages?: Partial<StorageRepo>
    s3?: Partial<S3Gateway>
    quota?: Partial<QuotaRepo>
    storageUsage?: Partial<StorageUsageRepo>
    activity?: Partial<ActivityRepo>
    share?: Partial<ShareRepo>
    org?: Partial<OrgRepo>
    objectUploadSessions?: Partial<ObjectUploadSessionRepo>
    downloaders?: Partial<DownloaderRepo>
    downloadTasks?: Partial<DownloadTaskRepo>
  } = {},
) {
  const record = vi.fn(async () => {})
  const deps = {
    matter: {
      get: async () => null,
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      create: async (input: Parameters<MatterRepo['create']>[0]) => file('new', input as Partial<Matter>),
      update: async () => null,
      copy: async (source: Matter, parent: string, object: string) =>
        file('copy', { parent, object, name: source.name }),
      cancelDraft: async () => null,
      trash: async () => null,
      restore: async () => null,
      collectForPurge: async () => null,
      purge: async () => {},
      planConflictResolution: async (_o: string, _p: string, name: string): Promise<ConflictPlan> => ({
        finalName: name,
        toTrash: null,
      }),
      commitConflictPlan: async () => {},
      activateDraft: async () => true,
      ...overrides.matter,
    } as unknown as MatterRepo,
    storages: {
      get: async () => storage,
      select: async () => storage,
      ...overrides.storages,
    } as unknown as StorageRepo,
    s3: {
      presignUpload: async () => 'https://upload.example',
      presignDownload: async () => 'https://download.example',
      copyObject: async () => {},
      deleteObject: async () => {},
      deleteObjects: async () => {},
      ...overrides.s3,
    } as unknown as S3Gateway,
    // Type placeholders for getObject's metering ports — meterDownloadTraffic is mocked.
    cloudTrafficReports: {} as unknown as CloudTrafficReportRepo,
    licenseBinding: {} as unknown as LicenseBindingRepo,
    licensingCloud: {} as unknown as LicensingCloudGateway,
    quota: {
      incrementUsageIfEffectiveQuotaAllows: async () => true,
      refundTraffic: async () => {},
      ...overrides.quota,
    } as unknown as QuotaRepo,
    storageUsage: {
      reconcile: async () => {},
      rollbackReservations: async () => {},
      ...overrides.storageUsage,
    } as unknown as StorageUsageRepo,
    activity: { record, ...overrides.activity } as unknown as ActivityRepo,
    share: {
      cascadeDeleteByMatter: async () => {},
      computeSourceBytes: async () => 0,
      hasQuotaForBytes: async () => true,
      ...overrides.share,
    } as unknown as ShareRepo,
    org: {
      getMemberRole: async () => null,
      isPersonalOrg: async () => true,
      canReadOrg: async () => true,
      canWriteToOrg: async () => true,
      ...overrides.org,
    } as unknown as OrgRepo,
    objectUploadSessions: {
      create: async (input: Parameters<ObjectUploadSessionRepo['create']>[0]) =>
        ({
          id: 'sess-1',
          objectId: input.objectId,
          uploadId: input.uploadId,
          partSize: input.partSize,
          status: 'active',
          storageKey: input.storageKey,
          expiresAt: new Date(Date.now() + 3_600_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as ObjectUploadSessionRecord,
      get: async () => null,
      setStatus: async () => {},
      ...overrides.objectUploadSessions,
    } as unknown as ObjectUploadSessionRepo,
    downloaders: { ...overrides.downloaders } as unknown as DownloaderRepo,
    downloadTasks: {
      findRecord: async () =>
        ({ id: 't1', assignedDownloaderId: 'd1', status: 'uploading' }) as unknown as DownloadTaskRecord,
      ...overrides.downloadTasks,
    } as unknown as DownloadTaskRepo,
  }
  return { deps, record }
}

beforeEach(() => vi.clearAllMocks())

describe('object usecase', () => {
  describe('listObjects', () => {
    it('lists the active org without an override', async () => {
      const list = vi.fn(async () => ({ items: [file('m1')], total: 1, page: 1, pageSize: 20 }))
      const { deps } = makeDeps({ matter: { list } })
      const out = await listObjects(deps, {
        orgId: 'o1',
        userId: 'u1',
        filters: { parent: '', status: 'active', page: 1, pageSize: 20 },
      })
      expect(out).toEqual({ ok: true, result: { items: [file('m1')], total: 1, page: 1, pageSize: 20 } })
      expect(list).toHaveBeenCalledWith('o1', { parent: '', status: 'active', page: 1, pageSize: 20 })
    })

    it('browses an override org the user can read', async () => {
      const list = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }))
      const canReadOrg = vi.fn(async () => true)
      const { deps } = makeDeps({ matter: { list }, org: { canReadOrg } })
      const out = await listObjects(deps, {
        orgId: 'o1',
        userId: 'u1',
        orgOverride: 'o2',
        filters: { parent: '', status: 'active', page: 1, pageSize: 20 },
      })
      expect(out.ok).toBe(true)
      expect(canReadOrg).toHaveBeenCalledWith('u1', 'o2')
      expect(list).toHaveBeenCalledWith('o2', expect.anything())
    })

    it('forbids an override org the user cannot read', async () => {
      const list = vi.fn()
      const { deps } = makeDeps({ matter: { list }, org: { canReadOrg: async () => false } })
      const out = await listObjects(deps, {
        orgId: 'o1',
        userId: 'u1',
        orgOverride: 'o2',
        filters: { parent: '', status: 'active', page: 1, pageSize: 20 },
      })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
      expect(list).not.toHaveBeenCalled()
    })
  })

  describe('hasEditorAccess', () => {
    it('grants editor+ member roles', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => 'editor' } })
      expect(await hasEditorAccess(deps, { orgId: 'o1', userId: 'u1' })).toBe(true)
    })
    it('denies viewer role', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => 'viewer' } })
      expect(await hasEditorAccess(deps, { orgId: 'o1', userId: 'u1' })).toBe(false)
    })
    it('falls back to personal-org ownership when no member row', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => null, isPersonalOrg: async () => true } })
      expect(await hasEditorAccess(deps, { orgId: 'o1', userId: 'u1' })).toBe(true)
    })
    it('returns false without an org or user', async () => {
      const { deps } = makeDeps()
      expect(await hasEditorAccess(deps, { orgId: null, userId: 'u1' })).toBe(false)
      expect(await hasEditorAccess(deps, { orgId: 'o1', userId: null })).toBe(false)
    })
  })

  describe('createObject', () => {
    it('creates a folder without presigning an upload', async () => {
      const create = vi.fn(async () => folder('f1', { name: 'My Folder' }))
      const presignUpload = vi.fn()
      const { deps } = makeDeps({ matter: { create }, s3: { presignUpload } })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: user,
        input: { name: 'My Folder', type: 'folder', dirtype: DirType.USER_FOLDER, parent: '' },
      })
      expect(out).toEqual({ ok: true, matter: folder('f1', { name: 'My Folder' }) })
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'folder', size: 0, status: 'active', object: '', userId: 'u1' }),
      )
      expect(presignUpload).not.toHaveBeenCalled()
    })

    it('creates a file draft and returns a presigned upload URL', async () => {
      const draft = file('d1', { status: 'draft', object: 'o1/u1/key.jpg', name: 'photo.jpg', type: 'image/jpeg' })
      const { deps } = makeDeps({
        matter: { create: async () => draft },
        s3: { presignUpload: async () => 'https://up' },
      })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: user,
        input: { name: 'photo.jpg', type: 'image/jpeg', size: 2048, dirtype: DirType.FILE, parent: '' },
      })
      expect(out.ok).toBe(true)
      if (out.ok && 'uploadUrl' in out) {
        expect(out.uploadUrl).toBe('https://up')
        expect(out.contentDisposition).toContain('attachment')
      } else {
        throw new Error('expected upload outcome')
      }
    })

    it('returns no_storage when no storage is configured', async () => {
      const { deps } = makeDeps({
        storages: {
          select: async () => {
            throw new Error('No available storage')
          },
        },
      })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: user,
        input: { name: 'x.txt', type: 'text/plain', dirtype: DirType.FILE, parent: '' },
      })
      expect(out).toEqual({ ok: false, reason: 'no_storage' })
    })

    it('rejects an agent upload outside its target folder', async () => {
      const create = vi.fn()
      const { deps } = makeDeps({ matter: { create } })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: {
          kind: 'download-task-upload',
          downloaderId: 'd1',
          taskId: 't1',
          targetFolder: 'Inbox',
          createdByUserId: 'creator',
        },
        input: { name: 'x.txt', type: 'text/plain', dirtype: DirType.FILE, parent: 'Other' },
      })
      expect(out).toEqual({ ok: false, reason: 'target_outside_authorization' })
      expect(create).not.toHaveBeenCalled()
    })

    it('logs an agent upload as the downloader and keys it to the task creator', async () => {
      const create = vi.fn(async (input: Parameters<MatterRepo['create']>[0]) => file('m', input as Partial<Matter>))
      const { deps } = makeDeps({ matter: { create } })
      await createObject(deps, {
        orgId: 'o1',
        actor: {
          kind: 'download-task-upload',
          downloaderId: 'd1',
          taskId: 't1',
          targetFolder: 'Inbox',
          createdByUserId: 'creator',
        },
        input: { name: 'x.txt', type: 'text/plain', dirtype: DirType.FILE, parent: 'Inbox' },
      })
      const arg = create.mock.calls[0][0]
      expect(arg.userId).toBe('downloader:d1')
      // object key uses the creator's uid
      expect(arg.object).toContain('o1/creator/')
    })
  })

  describe('createUploadSession', () => {
    it('starts a multipart session for a draft file', async () => {
      const draft = file('d1', { status: 'draft', object: 'key/d1', type: 'text/plain' })
      const createMultipartUpload = vi.fn(async () => 'upload-123')
      const { deps } = makeDeps({
        matter: { get: async () => draft },
        s3: { createMultipartUpload } as Partial<S3Gateway>,
      })
      const session = await createUploadSession(deps, { orgId: 'o1', objectId: 'd1', actor: user })
      expect(session.uploadId).toBe('upload-123')
      expect(session.status).toBe('active')
      expect(createMultipartUpload).toHaveBeenCalledWith(storage, 'key/d1', 'text/plain')
    })

    it('throws not_found when the object is not a draft file', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { status: 'active' }) } })
      await expect(createUploadSession(deps, { orgId: 'o1', objectId: 'm1', actor: user })).rejects.toBeInstanceOf(
        ObjectUploadSessionError,
      )
    })

    it('throws not_found when the storage is missing', async () => {
      const draft = file('d1', { status: 'draft', object: 'key/d1' })
      const { deps } = makeDeps({ matter: { get: async () => draft }, storages: { get: async () => null } })
      await expect(createUploadSession(deps, { orgId: 'o1', objectId: 'd1', actor: user })).rejects.toMatchObject({
        code: 'not_found',
      })
    })

    it('rejects an agent session outside the target folder with invalid_state', async () => {
      const draft = file('d1', { status: 'draft', object: 'key/d1', parent: 'Other' })
      const { deps } = makeDeps({ matter: { get: async () => draft } })
      await expect(
        createUploadSession(deps, {
          orgId: 'o1',
          objectId: 'd1',
          actor: {
            kind: 'download-task-upload',
            downloaderId: 'd1',
            taskId: 't1',
            targetFolder: 'Inbox',
            createdByUserId: 'creator',
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid_state' })
    })
  })

  describe('getObject', () => {
    it('returns a folder without metering or presigning', async () => {
      const presignDownload = vi.fn()
      const { deps } = makeDeps({ matter: { get: async () => folder('f1') }, s3: { presignDownload } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'f1', cloudBaseUrl: 'https://cloud' })
      expect(out).toEqual({ ok: true, matter: folder('f1') })
      expect(meterDownloadTraffic).not.toHaveBeenCalled()
      expect(presignDownload).not.toHaveBeenCalled()
    })

    it('returns not_found for a missing object', async () => {
      const { deps } = makeDeps({ matter: { get: async () => null } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'x', cloudBaseUrl: 'https://cloud' })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns storage_not_found when a file has no storage row', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1') }, storages: { get: async () => null } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expect(out).toEqual({ ok: false, reason: 'storage_not_found' })
    })

    it('meters egress then presigns the download URL for a file', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: true })
      const presignDownload = vi.fn(async () => 'https://signed')
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { size: 100 }) }, s3: { presignDownload } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expect(out).toMatchObject({ ok: true, downloadUrl: 'https://signed' })
      expect(meterDownloadTraffic).toHaveBeenCalledWith(
        deps,
        expect.objectContaining({
          cloudBaseUrl: 'https://cloud',
          orgId: 'o1',
          bytes: 100,
          source: 'object_download',
          sourceId: 'm1',
        }),
      )
    })

    it('maps a quota_exceeded metering outcome and never presigns', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: false, reason: 'quota_exceeded' })
      const presignDownload = vi.fn()
      const { deps } = makeDeps({ matter: { get: async () => file('m1') }, s3: { presignDownload } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expect(out).toEqual({ ok: false, reason: 'quota_exceeded' })
      expect(presignDownload).not.toHaveBeenCalled()
    })

    it('maps an insufficient_credits metering outcome', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: false, reason: 'insufficient_credits' })
      const { deps } = makeDeps({ matter: { get: async () => file('m1') } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expect(out).toEqual({ ok: false, reason: 'insufficient_credits' })
    })

    it('refunds the traffic and rethrows when presign fails after metering', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: true })
      const refundTraffic = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { size: 250 }) },
        quota: { refundTraffic },
        s3: {
          presignDownload: async () => {
            throw new Error('sign failed')
          },
        },
      })
      await expect(getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })).rejects.toThrow(
        'sign failed',
      )
      expect(refundTraffic).toHaveBeenCalledWith('o1', 250)
    })
  })

  describe('updateObject', () => {
    it('renames and returns the matter', async () => {
      const update = vi.fn(async () => file('m1', { name: 'New.txt' }))
      const { deps } = makeDeps({ matter: { update } })
      const out = await updateObject(deps, {
        orgId: 'o1',
        objectId: 'm1',
        actorId: 'u1',
        input: { action: 'update', name: 'New.txt' },
      })
      expect(out).toEqual({ ok: true, matter: file('m1', { name: 'New.txt' }) })
      expect(update).toHaveBeenCalledWith(
        'm1',
        'o1',
        { name: 'New.txt', parent: undefined, onConflict: undefined },
        'u1',
      )
    })

    it('returns not_found when the matter is missing', async () => {
      const { deps } = makeDeps({ matter: { update: async () => null } })
      const out = await updateObject(deps, {
        orgId: 'o1',
        objectId: 'x',
        actorId: 'u1',
        input: { action: 'update', name: 'X' },
      })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  describe('confirmObject', () => {
    it('confirms a draft and reserves quota', async () => {
      const draft = file('d1', { status: 'draft', size: 350 })
      const increment = vi.fn(async () => true)
      const { deps, record } = makeDeps({
        matter: { get: async () => draft, activateDraft: async () => true },
        quota: { incrementUsageIfEffectiveQuotaAllows: increment },
      })
      const out = await confirmObject(deps, { orgId: 'o1', objectId: 'd1', actorId: 'u1' })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.matter.status).toBe('active')
      expect(increment).toHaveBeenCalledWith('o1', 'st-1', 350, true)
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'upload_confirm' }))
    })

    it('returns not_found for a non-draft object', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { status: 'active' }) } })
      const out = await confirmObject(deps, { orgId: 'o1', objectId: 'm1', actorId: 'u1' })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns quota_exceeded when the reservation is rejected', async () => {
      const draft = file('d1', { status: 'draft', size: 50 })
      const { deps } = makeDeps({
        matter: { get: async () => draft },
        quota: { incrementUsageIfEffectiveQuotaAllows: async () => false },
      })
      const out = await confirmObject(deps, { orgId: 'o1', objectId: 'd1', actorId: 'u1' })
      expect(out).toEqual({ ok: false, reason: 'quota_exceeded' })
    })

    it('propagates a name conflict thrown during confirm', async () => {
      const draft = file('d1', { status: 'draft' })
      const { deps } = makeDeps({
        matter: {
          get: async () => draft,
          planConflictResolution: async () => {
            throw new (await import('./ports')).NameConflictError('upload.txt', 'active1')
          },
        },
      })
      await expect(confirmObject(deps, { orgId: 'o1', objectId: 'd1', actorId: 'u1' })).rejects.toMatchObject({
        name: 'NameConflictError',
      })
    })
  })

  describe('cancelObject', () => {
    it('cancels a draft and deletes its S3 object', async () => {
      const draft = file('d1', { status: 'draft', object: 'key/d1' })
      const deleteObjectFn = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: { cancelDraft: async () => draft },
        s3: { deleteObject: deleteObjectFn },
      })
      const out = await cancelObject(deps, { orgId: 'o1', objectId: 'd1', actorId: 'u1' })
      expect(out).toEqual({ ok: true, id: 'd1' })
      expect(deleteObjectFn).toHaveBeenCalledWith(storage, 'key/d1')
    })

    it('swallows an S3 delete failure during cancel', async () => {
      const draft = file('d1', { status: 'draft', object: 'key/d1' })
      const { deps } = makeDeps({
        matter: { cancelDraft: async () => draft },
        s3: {
          deleteObject: async () => {
            throw new Error('gone')
          },
        },
      })
      const out = await cancelObject(deps, { orgId: 'o1', objectId: 'd1', actorId: 'u1' })
      expect(out).toEqual({ ok: true, id: 'd1' })
    })

    it('returns not_found for a non-draft object', async () => {
      const { deps } = makeDeps({ matter: { cancelDraft: async () => null } })
      const out = await cancelObject(deps, { orgId: 'o1', objectId: 'x', actorId: 'u1' })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
    })
  })

  describe('trashObject / restoreObject', () => {
    it('trashes a matter', async () => {
      const { deps } = makeDeps({ matter: { trash: async () => file('m1', { status: 'trashed', trashedAt: 1 }) } })
      const out = await trashObject(deps, { orgId: 'o1', objectId: 'm1', actorId: 'u1' })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.matter.status).toBe('trashed')
    })

    it('trash returns not_found when missing', async () => {
      const { deps } = makeDeps({ matter: { trash: async () => null } })
      expect(await trashObject(deps, { orgId: 'o1', objectId: 'x', actorId: 'u1' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })

    it('restores with the default fail strategy', async () => {
      const restore = vi.fn(async () => file('m1', { status: 'active' }))
      const { deps } = makeDeps({ matter: { restore } })
      const out = await restoreObject(deps, { orgId: 'o1', objectId: 'm1', actorId: 'u1' })
      expect(out.ok).toBe(true)
      expect(restore).toHaveBeenCalledWith('o1', 'm1', 'u1', 'fail')
    })

    it('restore passes the given onConflict strategy', async () => {
      const restore = vi.fn(async () => file('m1', { status: 'active' }))
      const { deps } = makeDeps({ matter: { restore } })
      await restoreObject(deps, { orgId: 'o1', objectId: 'm1', actorId: 'u1', onConflict: 'rename' })
      expect(restore).toHaveBeenCalledWith('o1', 'm1', 'u1', 'rename')
    })

    it('restore returns not_found when missing', async () => {
      const { deps } = makeDeps({ matter: { restore: async () => null } })
      expect(await restoreObject(deps, { orgId: 'o1', objectId: 'x', actorId: 'u1' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })
  })

  describe('deleteObject (purge)', () => {
    it('purges a trashed subtree and records activity', async () => {
      const subtree = [folder('f1', { status: 'trashed' }), file('m1', { status: 'trashed', parent: 'f1' })]
      const purge = vi.fn(async () => {})
      const deleteObjects = vi.fn(async () => {})
      const { deps, record } = makeDeps({
        matter: { collectForPurge: async () => subtree, purge },
        s3: { deleteObjects },
      })
      const out = await deleteObject(deps, { orgId: 'o1', objectId: 'f1', userId: 'u1' })
      expect(out).toEqual({ ok: true, id: 'f1', purged: 2 })
      expect(purge).toHaveBeenCalledWith('o1', ['f1', 'm1'])
      expect(deleteObjects).toHaveBeenCalled()
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'object_purge', targetType: 'folder', metadata: { count: 2 } }),
      )
    })

    it('returns not_found when the object does not exist', async () => {
      const { deps } = makeDeps({
        matter: { collectForPurge: (async () => null) as unknown as MatterRepo['collectForPurge'] },
      })
      expect(await deleteObject(deps, { orgId: 'o1', objectId: 'x', userId: 'u1' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })

    it('returns not_trashed when the object is still active', async () => {
      const { deps, record } = makeDeps({
        matter: { collectForPurge: async () => [folder('f1', { status: 'active' })] },
      })
      const out = await deleteObject(deps, { orgId: 'o1', objectId: 'f1', userId: 'u1' })
      expect(out).toEqual({ ok: false, reason: 'not_trashed' })
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('copyObject', () => {
    it('copies a file: reserves quota, copies the S3 object, creates the matter', async () => {
      const source = file('src', { size: 200, object: 'key/src' })
      const copyObjectS3 = vi.fn(async () => {})
      const increment = vi.fn(async () => true)
      const copy = vi.fn(async () => file('cp', { parent: 'Dest', name: source.name }))
      const { deps } = makeDeps({
        matter: { get: async () => source, copy },
        s3: { copyObject: copyObjectS3 },
        quota: { incrementUsageIfEffectiveQuotaAllows: increment },
      })
      const out = await copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'src', parent: 'Dest' } })
      expect(out.ok).toBe(true)
      expect(increment).toHaveBeenCalledWith('o1', 'st-1', 200, true)
      expect(copyObjectS3).toHaveBeenCalled()
      expect(copy).toHaveBeenCalled()
    })

    it('returns not_found for a missing source', async () => {
      const { deps } = makeDeps({ matter: { get: async () => null } })
      expect(await copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'x', parent: '' } })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })

    it('returns storage_not_found for an object-backed source with no storage', async () => {
      const source = file('src', { object: 'key/src' })
      const { deps } = makeDeps({ matter: { get: async () => source }, storages: { get: async () => null } })
      const out = await copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'src', parent: '' } })
      expect(out).toEqual({ ok: false, reason: 'storage_not_found' })
    })

    it('rolls back the S3 copy when the matter copy fails', async () => {
      const source = file('src', { size: 200, object: 'key/src' })
      const deleteObjectFn = vi.fn(async () => {})
      const rollback = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: {
          get: async () => source,
          copy: async () => {
            throw new Error('copy failed')
          },
        },
        s3: { copyObject: async () => {}, deleteObject: deleteObjectFn },
        storageUsage: { rollbackReservations: rollback },
      })
      await expect(
        copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'src', parent: '' } }),
      ).rejects.toThrow('copy failed')
      // onRollback deletes the freshly copied S3 object; reservation rolled back too.
      expect(deleteObjectFn).toHaveBeenCalled()
      expect(rollback).toHaveBeenCalled()
    })
  })

  describe('transferObject', () => {
    it('rejects a transfer to the same space', async () => {
      const { deps } = makeDeps()
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o1', targetParent: '', mode: 'copy' },
      })
      expect(out).toEqual({ ok: false, reason: 'same_org' })
    })

    it('returns not_found for a missing/inactive source', async () => {
      const { deps } = makeDeps({ matter: { get: async () => null } })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'copy' },
      })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
    })

    it('forbids a move without editor access on the source space', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { status: 'active' }) },
        org: { getMemberRole: async () => 'viewer', isPersonalOrg: async () => false },
      })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'move' },
      })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
    })

    it('forbids a transfer into a target the user cannot write', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { status: 'active' }) },
        org: { canWriteToOrg: async () => false },
      })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'copy' },
      })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
    })

    it('rejects a transfer that exceeds the target quota', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { status: 'active' }) },
        share: { computeSourceBytes: async () => 1000, hasQuotaForBytes: async () => false },
      })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'copy' },
      })
      expect(out).toEqual({ ok: false, reason: 'quota_exceeded' })
    })

    it('copies into the target without deleting the source', async () => {
      const source = file('m1', { status: 'active', object: 'key/m1' })
      const collectForPurge = vi.fn()
      const { deps } = makeDeps({
        matter: { get: async () => source, collectForPurge },
        storages: {
          get: async () => storage,
          select: async () => storage,
        },
        s3: { copyObject: async () => {} },
      })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'copy' },
      })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.result.sourceDeleted).toBe(false)
      expect(collectForPurge).not.toHaveBeenCalled()
    })

    it('moves: copies, purges the source subtree, and records moved_to_org', async () => {
      const source = file('m1', { status: 'active', object: 'key/m1' })
      const purge = vi.fn(async () => {})
      const { deps, record } = makeDeps({
        matter: {
          get: async () => source,
          collectForPurge: async () => [source],
          purge,
        },
        storages: { get: async () => storage, select: async () => storage },
        s3: { copyObject: async () => {}, deleteObjects: async () => {} },
      })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'move' },
      })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.result.sourceDeleted).toBe(true)
      expect(purge).toHaveBeenCalledWith('o1', ['m1'])
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'moved_to_org' }))
    })
  })

  describe('authorizeTaskUploadConfirm', () => {
    const taskParams = {
      orgId: 'o1',
      objectId: 'm1',
      taskId: 't1',
      downloaderId: 'd1',
      targetFolder: 'Inbox',
    }

    it('forbids any action other than confirm', async () => {
      const { deps } = makeDeps()
      expect(await authorizeTaskUploadConfirm(deps, { ...taskParams, action: 'update' })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })

    it('forbids confirming an object outside the target folder', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { parent: 'Other' }) } })
      expect(await authorizeTaskUploadConfirm(deps, { ...taskParams, action: 'confirm' })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })

    it('authorizes a confirm within the target folder for a live task', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { parent: 'Inbox' }) },
        downloadTasks: {
          findRecord: async () =>
            ({ id: 't1', assignedDownloaderId: 'd1', status: 'uploading' }) as unknown as DownloadTaskRecord,
        },
      })
      expect(await authorizeTaskUploadConfirm(deps, { ...taskParams, action: 'confirm' })).toEqual({ ok: true })
    })
  })
})
