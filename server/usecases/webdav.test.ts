import { DirType } from '@shared/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../platform/interface'
import type {
  ApiKeyAuth,
  ApiKeyGateway,
  CloudTrafficReportRepo,
  DavLock,
  DownloadTaskRecord,
  DownloadTaskRepo,
  LicenseBindingRepo,
  LicensingCloudGateway,
  Matter,
  MatterRepo,
  QuotaRepo,
  S3Gateway,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
  UserAdminRepo,
  WebDavPathRepo,
  WebDavStateRepo,
  WebDavTarget,
  WebDavWorkspace,
} from './ports'
import { ApiKeyRateLimitError, NameConflictError } from './ports'
import { meterDownloadTraffic } from './store/traffic-metering'
import {
  applyWebDavDeadProperties,
  copyWebDavCollection,
  copyWebDavFile,
  createWebDavCollection,
  createWebDavLock,
  deleteWebDavMatter,
  ensureParentCollection,
  meterWebDavDownload,
  moveWebDavMatter,
  putWebDavFile,
  refundWebDavTraffic,
  resolveWebDavAuth,
  resolveWebDavDownload,
} from './webdav'

// The download meter is its own end-to-end usecase (quota + cloud report +
// refund); the webdav usecase only orchestrates around it. Mock it and assert
// the wiring + outcome mapping here; cloud-traffic-metering.test.ts owns the
// internals.
vi.mock('./store/traffic-metering', () => ({
  meterDownloadTraffic: vi.fn(),
  confirmDownloadTraffic: vi.fn(async () => {}),
  reverseDownloadTraffic: vi.fn(async (deps, params) => deps.quota.refundTraffic(params.orgId, params.bytes)),
}))

const storage = {
  id: 'st-1',
  egressCreditBillingEnabled: false,
  egressCreditUnitBytes: 0,
  egressCreditPerUnit: 0,
} as unknown as StorageRecord

const workspace: WebDavWorkspace = {
  id: 'ws-1',
  name: 'Workspace',
  slug: 'workspace',
  pathSegment: 'workspace',
}

function file(id: string, overrides: Partial<Matter> = {}): Matter {
  return {
    id,
    orgId: 'ws-1',
    alias: `${id}-alias`,
    name: `${id}.txt`,
    type: 'text/plain',
    size: 100,
    dirtype: DirType.FILE,
    parent: '',
    object: `objects/${id}.txt`,
    storageId: 'st-1',
    status: 'active',
    trashedAt: null,
    purgedAt: null,
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    ...overrides,
  }
}

const folder = (id: string, overrides: Partial<Matter> = {}): Matter =>
  file(id, { dirtype: DirType.USER_FOLDER, size: 0, object: '', type: 'folder', ...overrides })

function target(overrides: Partial<WebDavTarget> = {}): WebDavTarget {
  return { workspace, mountRoot: false, parent: '', name: 'new.txt', matter: null, ...overrides }
}

const lock: DavLock = {
  id: 'lk-1',
  token: 'opaquelocktoken:abc',
  orgId: 'ws-1',
  resourcePath: 'new.txt',
  owner: 'tester',
  depth: '0',
  expiresAt: new Date(Date.now() + 3600_000),
  createdAt: new Date(),
  updatedAt: new Date(),
}

// A permissive default deps; tests override only the ports they exercise.
function makeDeps(
  overrides: {
    apiKeys?: Partial<ApiKeyGateway>
    userAdmin?: Partial<UserAdminRepo>
    matter?: Partial<MatterRepo>
    storages?: Partial<StorageRepo>
    s3?: Partial<S3Gateway>
    quota?: Partial<QuotaRepo>
    storageUsage?: Partial<StorageUsageRepo>
    webdavPath?: Partial<WebDavPathRepo>
    webdavState?: Partial<WebDavStateRepo>
    downloadTasks?: Partial<DownloadTaskRepo>
  } = {},
) {
  const deps = {
    apiKeys: {
      verifyApiKeyForPermission: async () => ({ id: 'k1', configId: 'webdav', referenceId: 'u1', permissions: null }),
      ...overrides.apiKeys,
    } as unknown as ApiKeyGateway,
    userAdmin: {
      matchesUsername: async () => true,
      ...overrides.userAdmin,
    } as unknown as UserAdminRepo,
    matter: {
      create: async (input: Parameters<MatterRepo['create']>[0]) => file('new', input as Partial<Matter>),
      copy: async (source: Matter, parent: string, object: string) =>
        file('copy', { parent, object, name: source.name }),
      update: async () => file('m1'),
      trash: async () => file('m1', { trashedAt: Date.now() }),
      trashByIds: async () => {},
      restoreActiveByIds: async () => {},
      touch: async () => {},
      applyUpload: async () => {},
      listActiveDescendants: async () => [],
      get: async () => null,
      ...overrides.matter,
    } as unknown as MatterRepo,
    storages: {
      get: async () => storage,
      select: async () => storage,
      ...overrides.storages,
    } as unknown as StorageRepo,
    s3: {
      getObjectBody: async () => new Uint8Array(),
      putObject: async (_s: unknown, _k: unknown, body: unknown, _t: unknown, len?: number) =>
        len ?? (body instanceof Uint8Array ? body.byteLength : 0),
      copyObject: async () => {},
      deleteObject: async () => {},
      ...overrides.s3,
    } as unknown as S3Gateway,
    // Type placeholders for meterWebDavDownload's metering ports — the metering
    // usecase itself (meterDownloadTraffic) is mocked.
    cloudTrafficReports: {} as unknown as CloudTrafficReportRepo,
    licenseBinding: {} as unknown as LicenseBindingRepo,
    licensingCloud: {} as unknown as LicensingCloudGateway,
    activity: { record: async () => {} },
    quota: {
      refundTraffic: async () => {},
      incrementUsageIfEffectiveQuotaAllows: async () => true,
      ...overrides.quota,
    } as unknown as QuotaRepo,
    storageUsage: {
      reconcile: async () => {},
      rollbackReservations: async () => {},
      ...overrides.storageUsage,
    } as unknown as StorageUsageRepo,
    webdavPath: {
      resolveWebDavPath: async () => target(),
      resolveExistingWebDavPath: async () => target(),
      listChildren: async () => [],
      listUserWorkspaces: async () => [workspace],
      ...overrides.webdavPath,
    } as unknown as WebDavPathRepo,
    webdavState: {
      activeLocks: async () => [],
      activeLocksForResources: async () => new Map(),
      listDeadPropertiesForResources: async () => new Map(),
      conflictingLocks: async () => [],
      applyDeadPropertyUpdate: async () => {},
      copyDeadProperties: async () => {},
      deleteWebDavState: async () => {},
      moveWebDavState: async () => {},
      createLock: async () => lock,
      refreshLock: async () => lock,
      removeLock: async () => true,
      ...overrides.webdavState,
    } as unknown as WebDavStateRepo,
    downloadTasks: {
      findActiveTargetWithin: async () => null,
      ...overrides.downloadTasks,
    } as unknown as DownloadTaskRepo,
  }
  return deps
}

const authParams = {
  auth: {} as ApiKeyAuth,
  db: {} as Database,
  username: 'user@example.com',
  password: 'secret',
  resource: 'webdav',
  action: 'read' as const,
  configId: 'webdav',
}

beforeEach(() => vi.clearAllMocks())

describe('webdav usecase', () => {
  describe('resolveWebDavAuth', () => {
    it('resolves the userId when the key verifies and the username matches', async () => {
      const verifyApiKeyForPermission = vi.fn(async () => ({
        id: 'k1',
        configId: 'webdav',
        referenceId: 'u9',
        permissions: null,
      }))
      const deps = makeDeps({ apiKeys: { verifyApiKeyForPermission } })
      const out = await resolveWebDavAuth(deps, authParams)
      expect(out).toEqual({ ok: true, userId: 'u9' })
      expect(verifyApiKeyForPermission).toHaveBeenCalledWith({}, {}, 'secret', 'webdav', 'read', 'webdav')
    })

    it('is unauthorized when the key does not verify', async () => {
      const deps = makeDeps({ apiKeys: { verifyApiKeyForPermission: async () => null } })
      expect(await resolveWebDavAuth(deps, authParams)).toEqual({ ok: false, reason: 'unauthorized' })
    })

    it('is unauthorized when the username does not match the key owner', async () => {
      const deps = makeDeps({ userAdmin: { matchesUsername: async () => false } })
      expect(await resolveWebDavAuth(deps, authParams)).toEqual({ ok: false, reason: 'unauthorized' })
    })

    it('surfaces a rate-limit with its retry window', async () => {
      const deps = makeDeps({
        apiKeys: {
          verifyApiKeyForPermission: async () => {
            throw new ApiKeyRateLimitError('slow down', 5000)
          },
        },
      })
      expect(await resolveWebDavAuth(deps, authParams)).toEqual({
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: 5000,
        message: 'slow down',
      })
    })

    it('treats any other verification error as unauthorized', async () => {
      const deps = makeDeps({
        apiKeys: {
          verifyApiKeyForPermission: async () => {
            throw new Error('boom')
          },
        },
      })
      expect(await resolveWebDavAuth(deps, authParams)).toEqual({ ok: false, reason: 'unauthorized' })
    })
  })

  describe('ensureParentCollection', () => {
    it('is a no-op for an empty parent', async () => {
      const resolveWebDavPath = vi.fn()
      const deps = makeDeps({ webdavPath: { resolveWebDavPath } })
      await ensureParentCollection(deps, { userId: 'u1', workspaceSlug: 'workspace', parent: '' })
      expect(resolveWebDavPath).not.toHaveBeenCalled()
    })

    it('throws 409 when the parent collection does not exist', async () => {
      const deps = makeDeps({ webdavPath: { resolveWebDavPath: async () => target({ matter: null }) } })
      await expect(
        ensureParentCollection(deps, { userId: 'u1', workspaceSlug: 'workspace', parent: 'Missing' }),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('throws 405 when the parent resolves to a file', async () => {
      const deps = makeDeps({ webdavPath: { resolveWebDavPath: async () => target({ matter: file('p1') }) } })
      await expect(
        ensureParentCollection(deps, { userId: 'u1', workspaceSlug: 'workspace', parent: 'file.txt' }),
      ).rejects.toMatchObject({ status: 405 })
    })

    it('passes for an existing folder parent', async () => {
      const deps = makeDeps({ webdavPath: { resolveWebDavPath: async () => target({ matter: folder('p1') }) } })
      await expect(
        ensureParentCollection(deps, { userId: 'u1', workspaceSlug: 'workspace', parent: 'Docs' }),
      ).resolves.toBeUndefined()
    })
  })

  describe('applyWebDavDeadProperties', () => {
    it('applies the update and touches the matter when present', async () => {
      const applyDeadPropertyUpdate = vi.fn(async () => {})
      const touch = vi.fn(async () => {})
      const deps = makeDeps({ webdavState: { applyDeadPropertyUpdate }, matter: { touch } })
      const operations = [
        { action: 'set' as const, property: { namespace: 'urn:x', name: 'color', value: '<color>red</color>' } },
      ]
      await applyWebDavDeadProperties(deps, { orgId: 'ws-1', resourcePath: 'a.txt', operations, matterId: 'm1' })
      expect(applyDeadPropertyUpdate).toHaveBeenCalledWith('ws-1', 'a.txt', operations)
      expect(touch).toHaveBeenCalledWith('ws-1', 'm1')
    })

    it('does not touch when there is no matter (workspace root)', async () => {
      const touch = vi.fn(async () => {})
      const deps = makeDeps({ matter: { touch } })
      await applyWebDavDeadProperties(deps, { orgId: 'ws-1', resourcePath: '', operations: [], matterId: null })
      expect(touch).not.toHaveBeenCalled()
    })
  })

  describe('resolveWebDavDownload', () => {
    it('returns not_found when the matter is missing', async () => {
      const deps = makeDeps({
        webdavPath: { resolveExistingWebDavPath: async () => target({ matter: null, name: 'missing.txt' }) },
      })
      expect(await resolveWebDavDownload(deps, { userId: 'u1', rawPath: '/dav/workspace/missing.txt' })).toEqual({
        ok: false,
        reason: 'not_found',
      })
    })

    it('returns workspace_not_found when no workspace resolves', async () => {
      const deps = makeDeps({
        webdavPath: {
          resolveExistingWebDavPath: async () => ({ ...target({ matter: file('m1') }), workspace: null }),
        },
      })
      expect(await resolveWebDavDownload(deps, { userId: 'u1', rawPath: '/dav/x' })).toEqual({
        ok: false,
        reason: 'workspace_not_found',
      })
    })

    it('returns not_a_file for a collection', async () => {
      const deps = makeDeps({
        webdavPath: { resolveExistingWebDavPath: async () => target({ matter: folder('d1') }) },
      })
      expect(await resolveWebDavDownload(deps, { userId: 'u1', rawPath: '/dav/workspace/d1' })).toEqual({
        ok: false,
        reason: 'not_a_file',
      })
    })

    it('returns storage_not_found when the file storage row is gone', async () => {
      const deps = makeDeps({
        webdavPath: { resolveExistingWebDavPath: async () => target({ matter: file('m1') }) },
        storages: { get: async () => null },
      })
      expect(await resolveWebDavDownload(deps, { userId: 'u1', rawPath: '/dav/workspace/m1.txt' })).toEqual({
        ok: false,
        reason: 'storage_not_found',
      })
    })

    it('resolves matter + workspace + storage for a file', async () => {
      const m = file('m1')
      const deps = makeDeps({ webdavPath: { resolveExistingWebDavPath: async () => target({ matter: m }) } })
      const out = await resolveWebDavDownload(deps, { userId: 'u1', rawPath: '/dav/workspace/m1.txt' })
      expect(out).toEqual({ ok: true, matter: m, workspace, storage })
    })
  })

  describe('meterWebDavDownload', () => {
    it('records zero-byte reads without consuming quota bytes', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: true })
      const deps = makeDeps()
      const out = await meterWebDavDownload(deps, {
        cloudBaseUrl: 'https://cloud',
        orgId: 'ws-1',
        userId: 'u1',
        matterId: 'm1',
        matterName: 'm1.txt',
        storage,
        bytes: 0,
        trafficEventId: 'traffic-1',
      })
      expect(out).toEqual({ ok: true })
      expect(meterDownloadTraffic).toHaveBeenCalledWith(deps, expect.objectContaining({ bytes: 0 }))
    })

    it('meters with the webdav_download source and forwards the outcome', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: true })
      const deps = makeDeps()
      const out = await meterWebDavDownload(deps, {
        cloudBaseUrl: 'https://cloud',
        orgId: 'ws-1',
        userId: 'u1',
        matterId: 'm1',
        matterName: 'm1.txt',
        storage,
        bytes: 12,
        trafficEventId: 'traffic-1',
      })
      expect(out).toEqual({ ok: true })
      expect(meterDownloadTraffic).toHaveBeenCalledWith(
        deps,
        expect.objectContaining({
          cloudBaseUrl: 'https://cloud',
          orgId: 'ws-1',
          bytes: 12,
          storage,
          source: 'webdav_download',
          sourceId: 'm1',
        }),
      )
    })

    it('forwards a quota_exceeded outcome', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: false, reason: 'quota_exceeded' })
      const deps = makeDeps()
      expect(
        await meterWebDavDownload(deps, {
          cloudBaseUrl: 'c',
          orgId: 'ws-1',
          userId: 'u1',
          matterId: 'm1',
          matterName: 'm1.txt',
          storage,
          bytes: 12,
          trafficEventId: 'traffic-1',
        }),
      ).toEqual({ ok: false, reason: 'quota_exceeded' })
    })

    it('forwards an insufficient_credits outcome', async () => {
      vi.mocked(meterDownloadTraffic).mockResolvedValue({ ok: false, reason: 'insufficient_credits' })
      const deps = makeDeps()
      expect(
        await meterWebDavDownload(deps, {
          cloudBaseUrl: 'c',
          orgId: 'ws-1',
          userId: 'u1',
          matterId: 'm1',
          matterName: 'm1.txt',
          storage,
          bytes: 12,
          trafficEventId: 'traffic-1',
        }),
      ).toEqual({ ok: false, reason: 'insufficient_credits' })
    })

    it('refundWebDavTraffic calls quota.refundTraffic', async () => {
      const refundTraffic = vi.fn(async () => {})
      const deps = makeDeps({ quota: { refundTraffic } })
      await refundWebDavTraffic(deps, { orgId: 'ws-1', bytes: 250, trafficEventId: 'traffic-1' })
      expect(refundTraffic).toHaveBeenCalledWith('ws-1', 250)
    })
  })

  describe('putWebDavFile', () => {
    const putParams = (overrides: Partial<Parameters<typeof putWebDavFile>[1]> = {}) => ({
      orgId: 'ws-1',
      userId: 'u1',
      target: target(),
      fileName: 'new.txt',
      parent: '',
      contentType: 'text/plain',
      contentLength: 9 as number | null,
      body: new Uint8Array(9),
      ...overrides,
    })

    it('returns no_storage when no storage is available', async () => {
      const deps = makeDeps({ storages: { select: async () => null as unknown as StorageRecord } })
      expect(await putWebDavFile(deps, putParams())).toEqual({ ok: false, reason: 'no_storage' })
    })

    it('creates a new file matter and returns 201', async () => {
      const create = vi.fn(async () => file('new'))
      const putObject = vi.fn(async () => 9)
      const deps = makeDeps({ matter: { create }, s3: { putObject } })
      const out = await putWebDavFile(deps, putParams())
      expect(out).toEqual({ ok: true, status: 201 })
      expect(putObject).toHaveBeenCalledWith(storage, expect.any(String), expect.any(Uint8Array), 'text/plain', 9)
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'new.txt', size: 9, dirtype: DirType.FILE, status: 'active' }),
      )
    })

    it('overwrites an existing file in place and returns 204', async () => {
      const applyUpload = vi.fn(async () => {})
      const deleteObject = vi.fn(async () => {})
      const existing = file('m1', { object: 'objects/m1.txt', size: 20 })
      const deps = makeDeps({ matter: { applyUpload }, s3: { deleteObject, putObject: async () => 5 } })
      const out = await putWebDavFile(deps, putParams({ target: target({ matter: existing }), contentLength: 5 }))
      expect(out).toEqual({ ok: true, status: 204 })
      // Same object key is reused (known length + existing object), so no delete.
      expect(applyUpload).toHaveBeenCalledWith('ws-1', 'm1', {
        type: 'text/plain',
        size: 5,
        object: 'objects/m1.txt',
      })
      expect(deleteObject).not.toHaveBeenCalled()
    })

    it('reconciles usage when an overwrite shrinks the file', async () => {
      const reconcile = vi.fn(async () => {})
      const existing = file('m1', { object: 'objects/m1.txt', size: 20 })
      const deps = makeDeps({ storageUsage: { reconcile }, s3: { putObject: async () => 5 } })
      await putWebDavFile(deps, putParams({ target: target({ matter: existing }), contentLength: 5 }))
      expect(reconcile).toHaveBeenCalledWith('ws-1', ['st-1'])
    })

    it('reserves the measured size after a streamed (no Content-Length) upload', async () => {
      const create = vi.fn(async () => file('new'))
      const reservations: number[] = []
      const incrementUsageIfEffectiveQuotaAllows = vi.fn(async (_o: string, _s: string, bytes: number) => {
        reservations.push(bytes)
        return true
      })
      const deps = makeDeps({
        matter: { create },
        s3: { putObject: async () => 42 },
        quota: { incrementUsageIfEffectiveQuotaAllows },
      })
      const out = await putWebDavFile(deps, putParams({ contentLength: null, body: new Uint8Array() }))
      expect(out).toEqual({ ok: true, status: 201 })
      // Known delta is 0 (unknown length) → reserved only after measuring 42 bytes.
      expect(reservations).toEqual([42])
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ size: 42 }))
    })

    it('rolls back the S3 write when persisting the matter fails', async () => {
      const deleteObject = vi.fn(async () => {})
      const deps = makeDeps({
        s3: { putObject: async () => 9, deleteObject },
        matter: {
          create: async () => {
            throw new Error('db down')
          },
        },
      })
      await expect(putWebDavFile(deps, putParams())).rejects.toThrow('db down')
      expect(deleteObject).toHaveBeenCalledWith(storage, expect.any(String))
    })

    it('propagates a quota error from the reservation', async () => {
      const deps = makeDeps({ quota: { incrementUsageIfEffectiveQuotaAllows: async () => false } })
      await expect(putWebDavFile(deps, putParams())).rejects.toMatchObject({ name: 'StorageQuotaExceededError' })
    })
  })

  describe('createWebDavCollection', () => {
    it('creates a folder matter under the selected private storage', async () => {
      const create = vi.fn(async () => folder('Projects'))
      const deps = makeDeps({ matter: { create } })
      await createWebDavCollection(deps, { orgId: 'ws-1', userId: 'u1', name: 'Projects', parent: 'Docs' })
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Projects',
          type: 'folder',
          dirtype: DirType.USER_FOLDER,
          parent: 'Docs',
          object: '',
          status: 'active',
        }),
      )
    })
  })

  describe('deleteWebDavMatter', () => {
    it('clears dav state then trashes the matter', async () => {
      const order: string[] = []
      const deleteWebDavState = vi.fn(async () => {
        order.push('state')
      })
      const trash = vi.fn(async () => {
        order.push('trash')
        return file('m1', { trashedAt: Date.now() })
      })
      const deps = makeDeps({ webdavState: { deleteWebDavState }, matter: { trash } })
      await deleteWebDavMatter(deps, { orgId: 'ws-1', resourcePath: 'gone.txt', matterId: 'm1', userId: 'u1' })
      expect(deleteWebDavState).toHaveBeenCalledWith('ws-1', 'gone.txt')
      expect(trash).toHaveBeenCalledWith('ws-1', 'm1', 'u1')
      expect(order).toEqual(['state', 'trash'])
    })

    it('rejects deleting a folder used by an active download task before changing dav state', async () => {
      const deleteWebDavState = vi.fn(async () => {})
      const trash = vi.fn(async () => folder('target'))
      const deps = makeDeps({
        matter: { get: async () => folder('target', { name: 'Downloads' }), trash },
        webdavState: { deleteWebDavState },
        downloadTasks: {
          findActiveTargetWithin: async () =>
            ({ id: 'task-1', targetFolder: 'Downloads/Movies' }) as DownloadTaskRecord,
        },
      })

      await expect(
        deleteWebDavMatter(deps, {
          orgId: 'ws-1',
          resourcePath: 'Downloads',
          matterId: 'target',
          userId: 'u1',
        }),
      ).rejects.toMatchObject({
        httpStatus: 409,
        meta: {
          reason: 'DIRECTORY_IN_USE',
          metadata: { taskId: 'task-1', targetFolder: 'Downloads/Movies' },
        },
      })
      expect(deleteWebDavState).not.toHaveBeenCalled()
      expect(trash).not.toHaveBeenCalled()
    })
  })

  describe('moveWebDavMatter', () => {
    it('renames/reparents the source and moves its dav state', async () => {
      const update = vi.fn(async () => file('m1'))
      const moveWebDavState = vi.fn(async () => {})
      const trash = vi.fn()
      const deps = makeDeps({ matter: { update, trash }, webdavState: { moveWebDavState } })
      await moveWebDavMatter(deps, {
        orgId: 'ws-1',
        userId: 'u1',
        sourceMatterId: 'm1',
        sourceResourcePath: 'src.txt',
        targetName: 'dst.txt',
        targetParent: 'Docs',
        targetResourcePath: 'Docs/dst.txt',
        replacedMatterId: null,
      })
      expect(update).toHaveBeenCalledWith('m1', 'ws-1', { name: 'dst.txt', parent: 'Docs' }, 'u1')
      expect(moveWebDavState).toHaveBeenCalledWith('ws-1', 'src.txt', 'Docs/dst.txt')
      expect(trash).not.toHaveBeenCalled()
    })

    it('trashes an overwritten destination before moving', async () => {
      const trash = vi.fn(async () => file('t1', { trashedAt: Date.now() }))
      const deleteWebDavState = vi.fn(async () => {})
      const deps = makeDeps({ matter: { trash }, webdavState: { deleteWebDavState } })
      await moveWebDavMatter(deps, {
        orgId: 'ws-1',
        userId: 'u1',
        sourceMatterId: 'm1',
        sourceResourcePath: 'src.txt',
        targetName: 'dst.txt',
        targetParent: '',
        targetResourcePath: 'dst.txt',
        replacedMatterId: 't1',
      })
      expect(deleteWebDavState).toHaveBeenCalledWith('ws-1', 'dst.txt')
      expect(trash).toHaveBeenCalledWith('ws-1', 't1', 'u1')
    })
  })

  describe('copyWebDavFile', () => {
    const copyParams = (overrides: Partial<Parameters<typeof copyWebDavFile>[1]> = {}) => ({
      orgId: 'ws-1',
      userId: 'u1',
      sourceMatter: file('src', { size: 12 }),
      sourceResourcePath: 'src.txt',
      targetName: 'dst.txt',
      targetParent: '',
      targetResourcePath: 'dst.txt',
      replacedMatterId: null,
      replacingTarget: false,
      ...overrides,
    })

    it('copies the object + matter + dead properties and returns 201', async () => {
      const copyObject = vi.fn(async () => {})
      const copyDeadProperties = vi.fn(async () => {})
      const copy = vi.fn(async (s: Matter, parent: string, object: string) =>
        file('copy', { parent, object, name: s.name }),
      )
      const deps = makeDeps({ s3: { copyObject }, matter: { copy }, webdavState: { copyDeadProperties } })
      const out = await copyWebDavFile(deps, copyParams())
      expect(out).toEqual({ ok: true, status: 201, location: 'dst.txt' })
      expect(copyObject).toHaveBeenCalledWith(storage, 'objects/src.txt', storage, expect.any(String))
      expect(copyDeadProperties).toHaveBeenCalledWith('ws-1', 'src.txt', 'dst.txt')
    })

    it('returns 204 and trashes the destination when overwriting', async () => {
      const trash = vi.fn(async () => file('t1', { trashedAt: Date.now() }))
      const deps = makeDeps({ matter: { trash } })
      const out = await copyWebDavFile(deps, copyParams({ replacedMatterId: 't1', replacingTarget: true }))
      expect(out).toEqual({ ok: true, status: 204, location: 'dst.txt' })
      expect(trash).toHaveBeenCalledWith('ws-1', 't1', 'u1')
    })

    it('returns storage_not_found when an object-backed source has no storage', async () => {
      const deps = makeDeps({ storages: { get: async () => null } })
      expect(await copyWebDavFile(deps, copyParams())).toEqual({ ok: false, reason: 'storage_not_found' })
    })

    it('rolls back the copied object when the matter copy fails', async () => {
      const deleteObject = vi.fn(async () => {})
      const deps = makeDeps({
        s3: { copyObject: async () => {}, deleteObject },
        matter: {
          copy: async () => {
            throw new NameConflictError('dst.txt', 'x')
          },
        },
      })
      await expect(copyWebDavFile(deps, copyParams())).rejects.toBeInstanceOf(NameConflictError)
      expect(deleteObject).toHaveBeenCalledWith(storage, expect.any(String))
    })

    it('copies a zero-object source (e.g. empty file) without touching S3', async () => {
      const copyObject = vi.fn(async () => {})
      const deps = makeDeps({ s3: { copyObject } })
      const out = await copyWebDavFile(deps, copyParams({ sourceMatter: file('src', { object: '', size: 0 }) }))
      expect(out.ok).toBe(true)
      expect(copyObject).not.toHaveBeenCalled()
    })
  })

  describe('copyWebDavCollection', () => {
    const tree = () => {
      const child = folder('child', { name: 'Nested', parent: 'Source' })
      const grandchild = file('gc', { name: 'note.txt', parent: 'Source/Nested', size: 12 })
      return { child, grandchild }
    }

    const collParams = (overrides: Partial<Parameters<typeof copyWebDavCollection>[1]> = {}) => ({
      orgId: 'ws-1',
      userId: 'u1',
      sourceMatter: folder('src', { name: 'Source' }),
      sourceRoot: 'Source',
      targetName: 'Copied',
      targetParent: '',
      targetResourcePath: 'Copied',
      targetMatter: null,
      replacingTarget: false,
      depth: 'infinity' as const,
      ...overrides,
    })

    it('recursively copies the root + descendants, rewriting parents and dead properties', async () => {
      const { child, grandchild } = tree()
      const copies: Array<{ name: string; parent: string }> = []
      const copy = vi.fn(async (s: Matter, parent: string, object: string) => {
        copies.push({ name: s.name, parent })
        return file('c', { name: s.name, parent, object })
      })
      const copyDeadProperties = vi.fn(async () => {})
      const deps = makeDeps({
        matter: { copy, listActiveDescendants: async () => [grandchild] },
        webdavPath: { listChildren: async () => [child] },
        webdavState: { copyDeadProperties },
      })
      const out = await copyWebDavCollection(deps, collParams())
      expect(out).toEqual({ ok: true, status: 201, location: 'Copied' })
      // Root first (renamed to the target name, matching the original), then
      // child under Copied, then grandchild under Copied/Nested.
      expect(copies).toEqual([
        { name: 'Copied', parent: '' },
        { name: 'Nested', parent: 'Copied' },
        { name: 'note.txt', parent: 'Copied/Nested' },
      ])
    })

    it('copies only the root when depth=0', async () => {
      const copy = vi.fn(async (s: Matter, parent: string) => file('c', { name: s.name, parent }))
      const listChildren = vi.fn(async () => [tree().child])
      const deps = makeDeps({ matter: { copy }, webdavPath: { listChildren } })
      const out = await copyWebDavCollection(deps, collParams({ depth: '0' }))
      expect(out.ok).toBe(true)
      // depth=0 ignores children for the copy ordering.
      expect(copy).toHaveBeenCalledTimes(1)
    })

    it('returns storage_not_found when a descendant file has no storage', async () => {
      const { grandchild } = tree()
      const deps = makeDeps({
        matter: { listActiveDescendants: async () => [grandchild] },
        storages: { get: async () => null },
      })
      expect(await copyWebDavCollection(deps, collParams())).toEqual({ ok: false, reason: 'storage_not_found' })
    })

    it('trashes created rows and restores the overwritten destination when a copy fails', async () => {
      const { grandchild } = tree()
      const trashByIds = vi.fn(async () => {})
      const restoreActiveByIds = vi.fn(async () => {})
      const targetMatter = folder('existing', { name: 'Copied' })
      let copyCount = 0
      const copy = vi.fn(async (s: Matter, parent: string) => {
        copyCount += 1
        if (copyCount === 2) throw new Error('copy failed')
        return file(`c${copyCount}`, { name: s.name, parent })
      })
      const deps = makeDeps({
        matter: { copy, trashByIds, restoreActiveByIds, listActiveDescendants: async () => [grandchild] },
        webdavPath: { listChildren: async () => [] },
      })
      await expect(copyWebDavCollection(deps, collParams({ targetMatter, replacingTarget: true }))).rejects.toThrow(
        'copy failed',
      )
      expect(trashByIds).toHaveBeenCalledWith('ws-1', ['c1'])
      expect(restoreActiveByIds).toHaveBeenCalledWith('ws-1', expect.arrayContaining(['existing']))
    })
  })

  describe('createWebDavLock', () => {
    it('acquires a lock on an existing resource without creating anything', async () => {
      const create = vi.fn()
      const putObject = vi.fn()
      const createLock = vi.fn(async () => lock)
      const deps = makeDeps({ matter: { create }, s3: { putObject }, webdavState: { createLock } })
      const out = await createWebDavLock(deps, {
        orgId: 'ws-1',
        userId: 'u1',
        resourcePath: 'doc.txt',
        target: target({ matter: file('m1'), name: 'doc.txt' }),
        owner: 'tester',
        depth: '0',
        timeoutSeconds: 600,
      })
      expect(out).toEqual({ lock, created: false })
      expect(create).not.toHaveBeenCalled()
      expect(putObject).not.toHaveBeenCalled()
      expect(createLock).toHaveBeenCalledWith({
        orgId: 'ws-1',
        resourcePath: 'doc.txt',
        owner: 'tester',
        depth: '0',
        timeoutSeconds: 600,
      })
    })

    it('lazily creates an empty file when locking an unmapped URL (created=true)', async () => {
      const putObject = vi.fn(async () => 0)
      const create = vi.fn(async () => file('new', { size: 0, type: 'application/octet-stream' }))
      const deps = makeDeps({ s3: { putObject }, matter: { create } })
      const out = await createWebDavLock(deps, {
        orgId: 'ws-1',
        userId: 'u1',
        resourcePath: 'new.txt',
        target: target({ matter: null, name: 'new.txt' }),
        owner: 'tester',
        depth: 'infinity',
        timeoutSeconds: 3600,
      })
      expect(out.created).toBe(true)
      expect(putObject).toHaveBeenCalledWith(
        storage,
        expect.any(String),
        expect.any(Uint8Array),
        'application/octet-stream',
      )
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'new.txt', size: 0, dirtype: DirType.FILE, status: 'active' }),
      )
    })
  })
})
