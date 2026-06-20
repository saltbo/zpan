import { DirType } from '@shared/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abortUpload,
  authorizeTaskUploadConfirm,
  completeUpload,
  copyObject,
  createObject,
  deleteObject,
  getObject,
  getTrashObject,
  hasEditorAccess,
  listObjects,
  listTrashedObjects,
  type ObjectActor,
  restoreObject,
  transferObject,
  trashObject,
  updateObject,
} from './object'
import {
  type ActivityRepo,
  AppError,
  type CloudTrafficReportRepo,
  type ConflictPlan,
  type DownloaderRepo,
  type DownloadTaskRecord,
  type DownloadTaskRepo,
  type LicenseBindingRepo,
  type LicensingCloudGateway,
  type Matter,
  type MatterRepo,
  type ObjectUploadSessionRecord,
  type ObjectUploadSessionRepo,
  type OrgRepo,
  type QuotaRepo,
  type S3Gateway,
  type ShareRepo,
  type StorageRecord,
  type StorageRepo,
  type StorageUsageRepo,
} from './ports'
import { meterDownloadTraffic } from './store/traffic-metering'

// Download metering is an end-to-end usecase of its own (quota + cloud report +
// refund); object.getObject only orchestrates around it. Mock it and assert the
// outcome mapping + presign rollback here; cloud-traffic-metering.test.ts owns
// the metering internals.
vi.mock('./store/traffic-metering', () => ({ meterDownloadTraffic: vi.fn() }))

const storage = {
  id: 'st-1',
  title: 'S3',
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

function expectError(out: unknown, httpStatus: number, message: string, reason?: string) {
  const e = (out as { ok: false; error: AppError }).error
  expect(e).toBeInstanceOf(AppError)
  expect(e.httpStatus).toBe(httpStatus)
  expect(e.message).toBe(message)
  if (reason) expect(e.meta.reason).toBe(reason)
}

describe('object usecase', () => {
  describe('listObjects', () => {
    it('lists the active org without an override', async () => {
      const list = vi.fn(async () => ({ items: [file('m1')], total: 1, page: 1, pageSize: 20 }))
      const { deps } = makeDeps({ matter: { list } })
      const out = await listObjects(deps, {
        orgId: 'o1',
        userId: 'u1',
        filters: { parent: '', page: 1, pageSize: 20 },
      })
      expect(out).toEqual({ ok: true, result: { items: [file('m1')], total: 1, page: 1, pageSize: 20 } })
      expect(list).toHaveBeenCalledWith('o1', { parent: '', page: 1, pageSize: 20 })
    })

    it('browses an override org the user can read', async () => {
      const list = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }))
      const canReadOrg = vi.fn(async () => true)
      const { deps } = makeDeps({ matter: { list }, org: { canReadOrg } })
      const out = await listObjects(deps, {
        orgId: 'o1',
        userId: 'u1',
        orgOverride: 'o2',
        filters: { parent: '', page: 1, pageSize: 20 },
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
        filters: { parent: '', page: 1, pageSize: 20 },
      })
      expectError(out, 403, 'Forbidden')
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

    it('creates a small file draft and returns single-PUT upload instructions', async () => {
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
      if (out.ok && 'upload' in out) {
        // ≤5 GiB → single PutObject: one URL, partSize equals the file size.
        expect(out.upload.sessionId).toBe('sess-1')
        expect(out.upload.urls).toEqual(['https://up'])
        expect(out.upload.partSize).toBe(2048)
        expect(out.matter.status).toBe('draft')
      } else {
        throw new Error('expected upload outcome')
      }
    })

    it('creates a large file draft and returns multipart upload instructions', async () => {
      const fiveGiB = 5 * 1024 * 1024 * 1024
      const size = fiveGiB + 1 // just over 5 GiB → two 5 GiB parts
      const draft = file('big', { status: 'draft', object: 'o1/u1/big.bin', name: 'big.bin', size })
      const createMultipartUpload = vi.fn(async () => 'mp-1')
      const presignUploadPart = vi.fn(async () => 'https://part')
      const { deps } = makeDeps({
        matter: { create: async () => draft },
        s3: { createMultipartUpload, presignUploadPart } as Partial<S3Gateway>,
      })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: user,
        input: { name: 'big.bin', type: 'application/octet-stream', size, dirtype: DirType.FILE, parent: '' },
      })
      expect(out.ok).toBe(true)
      if (out.ok && 'upload' in out) {
        expect(out.upload.partSize).toBe(fiveGiB)
        expect(out.upload.urls).toHaveLength(2)
        expect(createMultipartUpload).toHaveBeenCalled()
      } else {
        throw new Error('expected upload outcome')
      }
    })

    it('rejects a file larger than 5 TiB before creating a draft', async () => {
      const create = vi.fn()
      const { deps } = makeDeps({ matter: { create } })
      const out = await createObject(deps, {
        orgId: 'o1',
        actor: user,
        input: {
          name: 'huge.bin',
          type: 'application/octet-stream',
          size: 5 * 1024 * 1024 * 1024 * 1024 + 1,
          dirtype: DirType.FILE,
          parent: '',
        },
      })
      expectError(out, 400, 'File exceeds the 5 TiB maximum', 'FILE_TOO_LARGE')
      expect(create).not.toHaveBeenCalled()
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
      expectError(out, 503, 'No storage configured', 'NO_STORAGE_CONFIGURED')
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
      expectError(out, 403, 'Target folder is outside task authorization')
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

  // An active upload session record as the repo returns it. uploadId=null is a
  // single PutObject; a string is an S3 multipart upload.
  function session(overrides: Partial<ObjectUploadSessionRecord> = {}): ObjectUploadSessionRecord {
    return {
      id: 'sess-1',
      orgId: 'o1',
      objectId: 'd1',
      storageId: 'st-1',
      storageKey: 'key/d1',
      uploadId: null,
      partSize: 100,
      status: 'active',
      onConflict: 'fail',
      createdBy: 'u1',
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as ObjectUploadSessionRecord
  }

  describe('completeUpload', () => {
    it('finalizes a single-PUT draft after HEAD confirms the reported ETag', async () => {
      const draft = file('d1', { status: 'draft', size: 100 })
      const setStatus = vi.fn(async () => {})
      const headObject = vi.fn(async () => ({ size: 100, contentType: 'text/plain', etag: 'abc' }))
      const { deps } = makeDeps({
        matter: { get: async () => draft, activateDraft: async () => true },
        s3: { headObject } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session(), setStatus },
      })
      const out = await completeUpload(deps, {
        orgId: 'o1',
        objectId: 'd1',
        sessionId: 'sess-1',
        parts: [{ partNumber: 1, etag: 'abc' }],
        actorId: 'u1',
      })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.matter.status).toBe('active')
      expect(headObject).toHaveBeenCalledWith(storage, 'key/d1')
      expect(setStatus).toHaveBeenCalledWith('sess-1', 'completed')
    })

    it('tolerates quoted ETags from the client (strips quotes before comparing)', async () => {
      const draft = file('d1', { status: 'draft', size: 100 })
      const { deps } = makeDeps({
        matter: { get: async () => draft, activateDraft: async () => true },
        s3: { headObject: async () => ({ size: 100, contentType: 'text/plain', etag: 'abc' }) } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session(), setStatus: async () => {} },
      })
      const out = await completeUpload(deps, {
        orgId: 'o1',
        objectId: 'd1',
        sessionId: 'sess-1',
        parts: [{ partNumber: 1, etag: '"abc"' }],
        actorId: 'u1',
      })
      expect(out.ok).toBe(true)
    })

    it('rejects a single-PUT completion whose ETag does not match the HEAD', async () => {
      const draft = file('d1', { status: 'draft', size: 100 })
      const { deps } = makeDeps({
        matter: { get: async () => draft },
        s3: { headObject: async () => ({ size: 100, contentType: 'text/plain', etag: 'real' }) } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session(), setStatus: async () => {} },
      })
      await expect(
        completeUpload(deps, {
          orgId: 'o1',
          objectId: 'd1',
          sessionId: 'sess-1',
          parts: [{ partNumber: 1, etag: 'wrong' }],
          actorId: 'u1',
        }),
      ).rejects.toMatchObject({ code: 'invalid_state' })
    })

    it('completes a multipart draft via CompleteMultipartUpload', async () => {
      const draft = file('d1', { status: 'draft', size: 100 })
      const completeMultipartUpload = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: { get: async () => draft, activateDraft: async () => true },
        s3: { completeMultipartUpload } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session({ uploadId: 'mp-1' }), setStatus: async () => {} },
      })
      const out = await completeUpload(deps, {
        orgId: 'o1',
        objectId: 'd1',
        sessionId: 'sess-1',
        parts: [{ partNumber: 1, etag: 'e1' }],
        actorId: 'u1',
      })
      expect(out.ok).toBe(true)
      expect(completeMultipartUpload).toHaveBeenCalledWith(storage, 'key/d1', 'mp-1', [{ partNumber: 1, etag: 'e1' }])
    })

    it('throws not_found when the upload session is missing', async () => {
      const draft = file('d1', { status: 'draft' })
      const { deps } = makeDeps({
        matter: { get: async () => draft },
        objectUploadSessions: { get: async () => null },
      })
      await expect(
        completeUpload(deps, {
          orgId: 'o1',
          objectId: 'd1',
          sessionId: 'sess-1',
          parts: [{ partNumber: 1, etag: 'x' }],
          actorId: 'u1',
        }),
      ).rejects.toMatchObject({ code: 'not_found' })
    })

    it('returns quota_exceeded when the activation reservation is rejected', async () => {
      const draft = file('d1', { status: 'draft', size: 50 })
      const { deps } = makeDeps({
        matter: { get: async () => draft },
        s3: { headObject: async () => ({ size: 50, contentType: 'text/plain', etag: 'abc' }) } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session(), setStatus: async () => {} },
        quota: { incrementUsageIfEffectiveQuotaAllows: async () => false },
      })
      const out = await completeUpload(deps, {
        orgId: 'o1',
        objectId: 'd1',
        sessionId: 'sess-1',
        parts: [{ partNumber: 1, etag: 'abc' }],
        actorId: 'u1',
      })
      expectError(out, 422, 'Quota exceeded', 'QUOTA_EXCEEDED')
    })

    it('propagates a name conflict thrown during activation', async () => {
      const draft = file('d1', { status: 'draft' })
      const { deps } = makeDeps({
        matter: {
          get: async () => draft,
          planConflictResolution: async () => {
            throw new (await import('./ports')).NameConflictError('upload.txt', 'active1')
          },
        },
        s3: { headObject: async () => ({ size: 100, contentType: 'text/plain', etag: 'abc' }) } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session(), setStatus: async () => {} },
      })
      await expect(
        completeUpload(deps, {
          orgId: 'o1',
          objectId: 'd1',
          sessionId: 'sess-1',
          parts: [{ partNumber: 1, etag: 'abc' }],
          actorId: 'u1',
        }),
      ).rejects.toMatchObject({ name: 'NameConflictError' })
    })
  })

  describe('abortUpload', () => {
    it('aborts a single-PUT session: best-effort S3 delete + discards the draft', async () => {
      const setStatus = vi.fn(async () => {})
      const cancelDraft = vi.fn(async () => file('d1', { status: 'draft' }))
      const deleteObjectFn = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: { get: async () => file('d1', { status: 'draft' }), cancelDraft },
        s3: { deleteObject: deleteObjectFn },
        objectUploadSessions: { get: async () => session(), setStatus },
      })
      await abortUpload(deps, { orgId: 'o1', objectId: 'd1', sessionId: 'sess-1', actorId: 'u1' })
      expect(deleteObjectFn).toHaveBeenCalledWith(storage, 'key/d1')
      expect(setStatus).toHaveBeenCalledWith('sess-1', 'aborted')
      expect(cancelDraft).toHaveBeenCalledWith('d1', 'o1', 'u1')
    })

    it('aborts a multipart session via AbortMultipartUpload', async () => {
      const abortMultipartUpload = vi.fn(async () => {})
      const { deps } = makeDeps({
        matter: { get: async () => file('d1', { status: 'draft' }), cancelDraft: async () => file('d1') },
        s3: { abortMultipartUpload } as Partial<S3Gateway>,
        objectUploadSessions: { get: async () => session({ uploadId: 'mp-1' }), setStatus: async () => {} },
      })
      await abortUpload(deps, { orgId: 'o1', objectId: 'd1', sessionId: 'sess-1', actorId: 'u1' })
      expect(abortMultipartUpload).toHaveBeenCalledWith(storage, 'key/d1', 'mp-1')
    })

    it('is idempotent for an already-aborted session', async () => {
      const cancelDraft = vi.fn(async () => null)
      const { deps } = makeDeps({
        matter: { get: async () => file('d1', { status: 'draft' }), cancelDraft },
        objectUploadSessions: { get: async () => session({ status: 'aborted' }) },
      })
      await abortUpload(deps, { orgId: 'o1', objectId: 'd1', sessionId: 'sess-1', actorId: 'u1' })
      expect(cancelDraft).not.toHaveBeenCalled()
    })

    it('rejects aborting an already-completed session', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('d1', { status: 'draft' }) },
        objectUploadSessions: { get: async () => session({ status: 'completed' }) },
      })
      await expect(
        abortUpload(deps, { orgId: 'o1', objectId: 'd1', sessionId: 'sess-1', actorId: 'u1' }),
      ).rejects.toMatchObject({ code: 'invalid_state' })
    })
  })

  describe('listTrashedObjects / getTrashObject', () => {
    it('paginates trashed roots', async () => {
      const roots = [file('t1', { trashedAt: 2 }), file('t2', { trashedAt: 1 })]
      const { deps } = makeDeps({ matter: { listTrashedRoots: async () => roots } })
      const out = await listTrashedObjects(deps, { orgId: 'o1', page: 1, pageSize: 1 })
      expect(out.result.total).toBe(2)
      expect(out.result.items).toEqual([roots[0]])
    })

    it('returns a trashed object', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('t1', { trashedAt: 5 }) } })
      const out = await getTrashObject(deps, { orgId: 'o1', objectId: 't1' })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.matter.trashedAt).toBe(5)
    })

    it('returns not_found for a live (non-trashed) object', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { trashedAt: null }) } })
      expectError(await getTrashObject(deps, { orgId: 'o1', objectId: 'm1' }), 404, 'Not found')
    })

    it('returns not_found for a missing object', async () => {
      const { deps } = makeDeps({ matter: { get: async () => null } })
      expectError(await getTrashObject(deps, { orgId: 'o1', objectId: 'x' }), 404, 'Not found')
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
      expectError(out, 404, 'Not found')
    })

    it('returns storage_not_found when a file has no storage row', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1') }, storages: { get: async () => null } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expectError(out, 404, 'Storage not found')
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
      expectError(out, 422, 'Traffic quota exceeded', 'QUOTA_EXCEEDED')
      expect(presignDownload).not.toHaveBeenCalled()
    })

    it('maps an insufficient_credits metering outcome', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: false, reason: 'insufficient_credits' })
      const { deps } = makeDeps({ matter: { get: async () => file('m1') } })
      const out = await getObject(deps, { orgId: 'o1', objectId: 'm1', cloudBaseUrl: 'https://cloud' })
      expectError(out, 402, 'Insufficient credits', 'INSUFFICIENT_CREDITS')
      expect((out as { ok: false; error: AppError }).error.meta.metadata).toEqual({ resource: 'storage_egress' })
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
        input: { name: 'New.txt' },
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
        input: { name: 'X' },
      })
      expectError(out, 404, 'Not found')
    })
  })

  describe('trashObject / restoreObject', () => {
    it('trashes a matter', async () => {
      // Trash = active row with trashedAt set (no 'trashed' status).
      const { deps } = makeDeps({ matter: { trash: async () => file('m1', { status: 'active', trashedAt: 1 }) } })
      const out = await trashObject(deps, { orgId: 'o1', objectId: 'm1', actorId: 'u1' })
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.matter.status).toBe('active')
        expect(out.matter.trashedAt).toBe(1)
      }
    })

    it('trash returns not_found when missing', async () => {
      const { deps } = makeDeps({ matter: { trash: async () => null } })
      expectError(await trashObject(deps, { orgId: 'o1', objectId: 'x', actorId: 'u1' }), 404, 'Not found')
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
      expectError(await restoreObject(deps, { orgId: 'o1', objectId: 'x', actorId: 'u1' }), 404, 'Not found')
    })
  })

  describe('deleteObject (purge)', () => {
    it('purges a trashed subtree and records activity', async () => {
      const subtree = [folder('f1', { trashedAt: 1 }), file('m1', { trashedAt: 1, parent: 'f1' })]
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
      expectError(
        await copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'x', parent: '' } }),
        404,
        'Not found',
      )
    })

    it('returns storage_not_found for an object-backed source with no storage', async () => {
      const source = file('src', { object: 'key/src' })
      const { deps } = makeDeps({ matter: { get: async () => source }, storages: { get: async () => null } })
      const out = await copyObject(deps, { orgId: 'o1', userId: 'u1', input: { copyFrom: 'src', parent: '' } })
      expectError(out, 404, 'Storage not found')
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
      expectError(out, 400, 'Target must be a different space', 'SAME_ORG')
    })

    it('returns not_found for a missing/inactive source', async () => {
      const { deps } = makeDeps({ matter: { get: async () => null } })
      const out = await transferObject(deps, {
        orgId: 'o1',
        userId: 'u1',
        objectId: 'm1',
        input: { targetOrgId: 'o2', targetParent: '', mode: 'copy' },
      })
      expectError(out, 404, 'Not found')
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
      expectError(out, 403, 'Forbidden')
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
      expectError(out, 403, 'Forbidden')
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
      expectError(out, 422, 'Quota exceeded', 'QUOTA_EXCEEDED')
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

    it('forbids confirming an object outside the target folder', async () => {
      const { deps } = makeDeps({ matter: { get: async () => file('m1', { parent: 'Other' }) } })
      expectError(await authorizeTaskUploadConfirm(deps, taskParams), 403, 'Forbidden')
    })

    it('authorizes a confirm within the target folder for a live task', async () => {
      const { deps } = makeDeps({
        matter: { get: async () => file('m1', { parent: 'Inbox' }) },
        downloadTasks: {
          findRecord: async () =>
            ({ id: 't1', assignedDownloaderId: 'd1', status: 'uploading' }) as unknown as DownloadTaskRecord,
        },
      })
      expect(await authorizeTaskUploadConfirm(deps, taskParams)).toEqual({ ok: true })
    })
  })
})
