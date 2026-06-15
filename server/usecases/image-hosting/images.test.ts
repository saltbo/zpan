import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateImageHostingInput,
  ImageHostingConfigRecord,
  ImageHostingConfigRepo,
  ImageHostingRecord,
  ImageHostingRepo,
  QuotaRepo,
  S3Gateway,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
} from '../ports'
import {
  confirmImageHosting,
  deleteImageHosting,
  getImageHosting,
  type ImageHostingDeps,
  listImageHostings,
  presignImageHostingUpload,
  removeImageHosting,
  requireImageHostingEnabled,
  uploadImageHosting,
} from './images'

// Fakes for the ports the image-hosting usecase touches. Each test overrides the
// handful of methods it exercises; the rest throw so an unexpected call is loud.

const sampleStorage = { id: 'st-1', title: 'S3', mode: 'private' } as StorageRecord

const sampleConfig: ImageHostingConfigRecord = {
  orgId: 'o1',
  customDomain: null,
  cfHostnameId: null,
  domainVerifiedAt: null,
  refererAllowlist: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function makeRow(over: Partial<ImageHostingRecord> = {}): ImageHostingRecord {
  return {
    id: 'ih-1',
    orgId: 'o1',
    token: 'ih_abc',
    path: 'a.png',
    storageId: 'st-1',
    storageKey: 'ih/o1/ih-1.png',
    size: 100,
    mime: 'image/png',
    width: null,
    height: null,
    status: 'draft',
    accessCount: 0,
    lastAccessedAt: null,
    createdAt: new Date(0),
    ...over,
  } as ImageHostingRecord
}

const notImpl = () => {
  throw new Error('not implemented')
}

function makeDeps(
  over: {
    imageHosting?: Partial<ImageHostingRepo>
    imageHostingConfigs?: Partial<ImageHostingConfigRepo>
    storages?: Partial<StorageRepo>
    s3?: Partial<S3Gateway>
    quota?: Partial<QuotaRepo>
    storageUsage?: Partial<StorageUsageRepo>
  } = {},
): ImageHostingDeps {
  return {
    imageHosting: {
      resolveActiveByToken: notImpl,
      resolveActiveByOrgPath: notImpl,
      resolveCustomDomain: notImpl,
      incrementAccessCount: notImpl,
      create: async (input: CreateImageHostingInput) => makeRow(input),
      get: async () => null,
      list: async () => ({ items: [], nextCursor: null }),
      setActive: async () => true,
      delete: async () => {},
      ...over.imageHosting,
    },
    imageHostingConfigs: {
      getByOrg: async () => sampleConfig,
      create: async () => {},
      update: async () => {},
      delete: async () => {},
      ...over.imageHostingConfigs,
    },
    storages: {
      list: notImpl,
      get: async () => sampleStorage,
      create: notImpl,
      count: notImpl,
      update: notImpl,
      delete: notImpl,
      select: async () => sampleStorage,
      ...over.storages,
    } as StorageRepo,
    s3: {
      presignUpload: async () => 'https://presigned.example/upload',
      putObject: async () => 0,
      deleteObject: async () => {},
      ...over.s3,
    } as S3Gateway,
    quota: {
      incrementUsageIfEffectiveQuotaAllows: async () => true,
      ...over.quota,
    } as QuotaRepo,
    storageUsage: {
      rollbackReservations: async () => {},
      reconcile: async () => {},
      ...over.storageUsage,
    } as StorageUsageRepo,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('image-hosting usecase', () => {
  describe('requireImageHostingEnabled', () => {
    it('returns the config when the org has a config row', async () => {
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => sampleConfig } })
      const out = await requireImageHostingEnabled(deps, 'o1')
      expect(out).toEqual({ ok: true, config: sampleConfig })
    })

    it('returns not_enabled when no config row exists', async () => {
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null } })
      const out = await requireImageHostingEnabled(deps, 'o1')
      expect(out).toEqual({ ok: false, reason: 'not_enabled' })
    })
  })

  describe('uploadImageHosting', () => {
    it('selects private storage, creates a draft, puts the object, flips active', async () => {
      const create = vi.fn(async (input: CreateImageHostingInput) => makeRow(input))
      const setActive = vi.fn(async () => true)
      const putObject = vi.fn(async () => 0)
      const select = vi.fn(async () => sampleStorage)
      const deps = makeDeps({
        imageHosting: { create, setActive },
        s3: { putObject },
        storages: { select },
      })
      const bytes = new Uint8Array(100)
      const out = await uploadImageHosting(deps, { orgId: 'o1', path: 'a.png', mime: 'image/png', bytes })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.row.path).toBe('a.png')
      expect(select).toHaveBeenCalledWith('private')
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'o1', status: 'draft', size: 100 }))
      expect(putObject).toHaveBeenCalledTimes(1)
      expect(setActive).toHaveBeenCalledTimes(1)
    })

    it('returns no_storage when select throws', async () => {
      const deps = makeDeps({
        storages: {
          select: async () => {
            throw new Error('no storage')
          },
        },
      })
      const out = await uploadImageHosting(deps, {
        orgId: 'o1',
        path: 'a.png',
        mime: 'image/png',
        bytes: new Uint8Array(1),
      })
      expect(out).toEqual({ ok: false, reason: 'no_storage' })
    })

    it('rolls back the row and object, then rethrows, when S3 put fails', async () => {
      const del = vi.fn(async () => {})
      const deleteObject = vi.fn(async () => {})
      const rollbackReservations = vi.fn(async () => {})
      const deps = makeDeps({
        imageHosting: { create: async (i) => makeRow(i), delete: del },
        s3: {
          putObject: async () => {
            throw new Error('S3 down')
          },
          deleteObject,
        },
        storageUsage: { rollbackReservations },
      })
      await expect(
        uploadImageHosting(deps, { orgId: 'o1', path: 'a.png', mime: 'image/png', bytes: new Uint8Array(100) }),
      ).rejects.toThrow('S3 down')
      expect(del).toHaveBeenCalledTimes(1)
      expect(deleteObject).toHaveBeenCalledTimes(1)
      expect(rollbackReservations).toHaveBeenCalledTimes(1)
    })

    it('propagates StorageQuotaExceededError when quota is denied', async () => {
      const deps = makeDeps({ quota: { incrementUsageIfEffectiveQuotaAllows: async () => false } })
      await expect(
        uploadImageHosting(deps, { orgId: 'o1', path: 'a.png', mime: 'image/png', bytes: new Uint8Array(100) }),
      ).rejects.toThrow('QUOTA_EXCEEDED')
    })
  })

  describe('presignImageHostingUpload', () => {
    it('creates a draft and returns the presigned upload descriptor', async () => {
      const row = makeRow({ id: 'ih-9', token: 'ih_zzz', path: 'blog/x.png', storageKey: 'ih/o1/ih-9.png' })
      const presignUpload = vi.fn(async () => 'https://presigned.example/up')
      const deps = makeDeps({
        imageHosting: { create: async () => row },
        s3: { presignUpload },
      })
      const out = await presignImageHostingUpload(deps, {
        orgId: 'o1',
        path: 'blog/x.png',
        mime: 'image/png',
        size: 2048,
      })
      expect(out).toEqual({
        ok: true,
        result: {
          id: 'ih-9',
          token: 'ih_zzz',
          path: 'blog/x.png',
          uploadUrl: 'https://presigned.example/up',
          storageKey: 'ih/o1/ih-9.png',
        },
      })
      expect(presignUpload).toHaveBeenCalledWith(sampleStorage, 'ih/o1/ih-9.png', 'image/png', 5 * 60)
    })

    it('returns no_storage when select throws', async () => {
      const deps = makeDeps({
        storages: {
          select: async () => {
            throw new Error('no storage')
          },
        },
      })
      const out = await presignImageHostingUpload(deps, { orgId: 'o1', path: 'a.png', mime: 'image/png', size: 1 })
      expect(out).toEqual({ ok: false, reason: 'no_storage' })
    })
  })

  describe('confirmImageHosting', () => {
    it('flips a draft to active', async () => {
      const setActive = vi.fn(async () => true)
      const deps = makeDeps({
        imageHosting: { get: async () => makeRow({ status: 'draft', size: 100 }), setActive },
      })
      const out = await confirmImageHosting(deps, 'ih-1', 'o1')
      expect(out.row?.status).toBe('active')
      expect(out.quotaExceeded).toBeUndefined()
      expect(setActive).toHaveBeenCalledTimes(1)
    })

    it('returns { row: null } for a missing row', async () => {
      const deps = makeDeps({ imageHosting: { get: async () => null } })
      expect(await confirmImageHosting(deps, 'x', 'o1')).toEqual({ row: null })
    })

    it('returns { row: null } for a non-draft (already active) row', async () => {
      const deps = makeDeps({ imageHosting: { get: async () => makeRow({ status: 'active' }) } })
      expect(await confirmImageHosting(deps, 'ih-1', 'o1')).toEqual({ row: null })
    })

    it('returns { row: null } when setActive loses the race', async () => {
      const deps = makeDeps({
        imageHosting: { get: async () => makeRow({ status: 'draft' }), setActive: async () => false },
      })
      expect(await confirmImageHosting(deps, 'ih-1', 'o1')).toEqual({ row: null })
    })

    it('returns quotaExceeded when the reservation is denied', async () => {
      const deps = makeDeps({
        imageHosting: { get: async () => makeRow({ status: 'draft', size: 100 }) },
        quota: { incrementUsageIfEffectiveQuotaAllows: async () => false },
      })
      const out = await confirmImageHosting(deps, 'ih-1', 'o1')
      expect(out).toEqual({ row: null, quotaExceeded: true })
    })

    it('skips quota for a size=0 draft and confirms', async () => {
      const inc = vi.fn(async () => false) // would deny if called
      const deps = makeDeps({
        imageHosting: { get: async () => makeRow({ status: 'draft', size: 0 }) },
        quota: { incrementUsageIfEffectiveQuotaAllows: inc },
      })
      const out = await confirmImageHosting(deps, 'ih-1', 'o1')
      expect(out.row?.status).toBe('active')
      expect(inc).not.toHaveBeenCalled()
    })
  })

  describe('listImageHostings / getImageHosting', () => {
    it('listImageHostings forwards the repo result', async () => {
      const items = [makeRow({ status: 'active' })]
      const deps = makeDeps({ imageHosting: { list: async () => ({ items, nextCursor: 'c1' }) } })
      expect(await listImageHostings(deps, 'o1', { limit: 50 })).toEqual({ items, nextCursor: 'c1' })
    })

    it('getImageHosting returns the row', async () => {
      const row = makeRow({ status: 'active' })
      const deps = makeDeps({ imageHosting: { get: async () => row } })
      expect(await getImageHosting(deps, 'ih-1', 'o1')).toBe(row)
    })

    it('getImageHosting returns null when missing', async () => {
      const deps = makeDeps({ imageHosting: { get: async () => null } })
      expect(await getImageHosting(deps, 'x', 'o1')).toBeNull()
    })
  })

  describe('deleteImageHosting', () => {
    it('returns null for a missing row', async () => {
      const deps = makeDeps({ imageHosting: { get: async () => null } })
      expect(await deleteImageHosting(deps, 'x', 'o1', sampleStorage)).toBeNull()
    })

    it('deletes the object, the row, and reconciles usage for an active sized row', async () => {
      const row = makeRow({ status: 'active', size: 2048, storageId: 'st-1' })
      const deleteObject = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const reconcile = vi.fn(async () => {})
      const deps = makeDeps({
        imageHosting: { get: async () => row, delete: del },
        s3: { deleteObject },
        storageUsage: { reconcile },
      })
      const out = await deleteImageHosting(deps, 'ih-1', 'o1', sampleStorage)
      expect(out).toBe(row)
      expect(deleteObject).toHaveBeenCalledTimes(1)
      expect(del).toHaveBeenCalledWith('ih-1', 'o1')
      expect(reconcile).toHaveBeenCalledWith('o1', ['st-1'])
    })

    it('skips S3 delete when storage is null but still deletes the row', async () => {
      const row = makeRow({ status: 'active', size: 100 })
      const deleteObject = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const deps = makeDeps({ imageHosting: { get: async () => row, delete: del }, s3: { deleteObject } })
      const out = await deleteImageHosting(deps, 'ih-1', 'o1', null)
      expect(out).toBe(row)
      expect(deleteObject).not.toHaveBeenCalled()
      expect(del).toHaveBeenCalledTimes(1)
    })

    it('swallows an S3 delete error and still deletes the row (best-effort)', async () => {
      const row = makeRow({ status: 'active', size: 100 })
      const del = vi.fn(async () => {})
      const deps = makeDeps({
        imageHosting: { get: async () => row, delete: del },
        s3: {
          deleteObject: async () => {
            throw new Error('S3 fail')
          },
        },
      })
      const out = await deleteImageHosting(deps, 'ih-1', 'o1', sampleStorage)
      expect(out).toBe(row)
      expect(del).toHaveBeenCalledTimes(1)
    })

    it('does not reconcile for a draft (or zero-size) row', async () => {
      const row = makeRow({ status: 'draft', size: 0 })
      const reconcile = vi.fn(async () => {})
      const deps = makeDeps({ imageHosting: { get: async () => row }, storageUsage: { reconcile } })
      await deleteImageHosting(deps, 'ih-1', 'o1', null)
      expect(reconcile).not.toHaveBeenCalled()
    })
  })

  describe('removeImageHosting', () => {
    it('returns null for a missing image (no storage lookup)', async () => {
      const get = vi.fn(async () => null)
      const storageGet = vi.fn(async () => sampleStorage)
      const deps = makeDeps({ imageHosting: { get }, storages: { get: storageGet } })
      expect(await removeImageHosting(deps, 'x', 'o1')).toBeNull()
      expect(storageGet).not.toHaveBeenCalled()
    })

    it('resolves the storage row then deletes the image', async () => {
      const row = makeRow({ status: 'active', size: 100, storageId: 'st-7' })
      const storageGet = vi.fn(async () => sampleStorage)
      const deleteObject = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const deps = makeDeps({
        imageHosting: { get: async () => row, delete: del },
        storages: { get: storageGet },
        s3: { deleteObject },
      })
      const out = await removeImageHosting(deps, 'ih-1', 'o1')
      expect(out).toBe(row)
      expect(storageGet).toHaveBeenCalledWith('st-7')
      expect(deleteObject).toHaveBeenCalledTimes(1)
      expect(del).toHaveBeenCalledTimes(1)
    })

    it('still deletes the image when the storage row is gone', async () => {
      const row = makeRow({ status: 'active', size: 100 })
      const deleteObject = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const deps = makeDeps({
        imageHosting: { get: async () => row, delete: del },
        storages: { get: async () => null },
        s3: { deleteObject },
      })
      const out = await removeImageHosting(deps, 'ih-1', 'o1')
      expect(out).toBe(row)
      expect(deleteObject).not.toHaveBeenCalled()
      expect(del).toHaveBeenCalledTimes(1)
    })
  })
})
