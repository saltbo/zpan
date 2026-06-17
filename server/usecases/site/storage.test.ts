import { FREE_STORAGE_LIMIT } from '@shared/constants'
import type { CreateStorageInput } from '@shared/schemas'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRepo, LicenseBindingRepo, StorageRecord, StorageRepo } from '../ports'
import { AppError } from '../ports'
import { loadBindingState } from './licensing'
import { createStorage, deleteStorage, getStorage, listStorages, type StorageDeps, updateStorage } from './storage'

// loadBindingState derives features from a signed certificate — out of scope for
// a usecase unit test. Mock it so each case feeds a chosen edition; the real
// (pure) hasFeature then runs against it. The full cert→features→gate path is
// covered by storages.integration.test.ts.
vi.mock('./licensing', () => ({ loadBindingState: vi.fn() }))

const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' } // has storages_unlimited, not quota_store
const BUSINESS: BindingState = { bound: true, active: true, edition: 'business' } // has both

const edition = (state: BindingState) => vi.mocked(loadBindingState).mockResolvedValue(state)

const sampleStorage = { id: 'st-1', title: 'My S3', mode: 'private' } as StorageRecord

const validInput: CreateStorageInput = {
  title: 'My S3',
  mode: 'private',
  bucket: 'b',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  accessKey: 'k',
  secretKey: 's',
} as CreateStorageInput

function makeDeps(storages: Partial<StorageRepo> = {}) {
  const record = vi.fn(async () => {})
  const repo: StorageRepo = {
    list: async () => ({ items: [], total: 0 }),
    get: async () => null,
    create: async () => sampleStorage,
    count: async () => 0,
    update: async () => null,
    delete: async () => 'ok',
    select: async () => sampleStorage,
    ...storages,
  }
  const deps: StorageDeps = {
    storages: repo,
    activity: { record } as unknown as ActivityRepo,
    licenseBinding: {} as LicenseBindingRepo, // unused — loadBindingState is mocked
  }
  return { deps, record }
}

beforeEach(() => vi.clearAllMocks())

describe('storage usecase', () => {
  it('listStorages forwards the repo result', async () => {
    const { deps } = makeDeps({ list: async () => ({ items: [sampleStorage], total: 1 }) })
    expect(await listStorages(deps)).toEqual({ items: [sampleStorage], total: 1 })
  })

  it('getStorage returns the record', async () => {
    const { deps } = makeDeps({ get: async () => sampleStorage })
    expect(await getStorage(deps, 'st-1')).toBe(sampleStorage)
  })

  it('getStorage returns null when missing', async () => {
    const { deps } = makeDeps({ get: async () => null })
    expect(await getStorage(deps, 'nope')).toBeNull()
  })

  describe('createStorage', () => {
    it('creates and records activity when under the Community limit', async () => {
      edition(COMMUNITY)
      const create = vi.fn(async () => sampleStorage)
      const { deps, record } = makeDeps({ count: async () => FREE_STORAGE_LIMIT - 1, create })
      const out = await createStorage(deps, { userId: 'u1', orgId: 'o1', input: validInput })
      expect(out).toEqual({ ok: true, storage: sampleStorage })
      expect(create).toHaveBeenCalledWith(validInput)
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'storage_create', targetId: 'st-1', orgId: 'o1', userId: 'u1' }),
      )
    })

    it('blocks at the Community storage limit without storages_unlimited', async () => {
      edition(COMMUNITY)
      const { deps, record } = makeDeps({ count: async () => FREE_STORAGE_LIMIT })
      const out = await createStorage(deps, { userId: 'u1', orgId: 'o1', input: validInput })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(402)
        expect(out.error.meta.reason).toBe('FEATURE_NOT_AVAILABLE')
        expect(out.error.meta.metadata).toEqual({
          feature: 'storages_unlimited',
          currentCount: String(FREE_STORAGE_LIMIT),
          limit: String(FREE_STORAGE_LIMIT),
        })
      }
      expect(record).not.toHaveBeenCalled()
    })

    it('allows creating past the limit with storages_unlimited', async () => {
      edition(PRO)
      const create = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ count: async () => FREE_STORAGE_LIMIT + 5, create })
      const out = await createStorage(deps, { userId: 'u1', orgId: 'o1', input: validInput })
      expect(out.ok).toBe(true)
      expect(create).toHaveBeenCalled()
    })

    it('blocks egress-credit billing when quota_store is absent', async () => {
      edition(PRO) // pro has storages_unlimited but not quota_store
      const { deps, record } = makeDeps({ count: async () => 0 })
      const out = await createStorage(deps, {
        userId: 'u1',
        orgId: 'o1',
        input: { ...validInput, egressCreditBillingEnabled: true },
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(402)
        expect(out.error.meta.reason).toBe('FEATURE_NOT_AVAILABLE')
        expect(out.error.meta.metadata).toEqual({ feature: 'quota_store' })
      }
      expect(record).not.toHaveBeenCalled()
    })

    it('allows egress-credit billing with quota_store (business)', async () => {
      edition(BUSINESS)
      const create = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ count: async () => 0, create })
      const out = await createStorage(deps, {
        userId: 'u1',
        orgId: 'o1',
        input: { ...validInput, egressCreditBillingEnabled: true },
      })
      expect(out.ok).toBe(true)
    })
  })

  describe('updateStorage', () => {
    it('updates and records activity', async () => {
      edition(COMMUNITY)
      const update = vi.fn(async () => sampleStorage)
      const { deps, record } = makeDeps({ update })
      const out = await updateStorage(deps, { userId: 'u1', orgId: 'o1', id: 'st-1', input: { title: 'New' } })
      expect(out).toEqual({ ok: true, storage: sampleStorage })
      expect(update).toHaveBeenCalledWith('st-1', { title: 'New' })
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'storage_update', targetId: 'st-1' }))
    })

    it('returns not_found for a missing storage', async () => {
      edition(COMMUNITY)
      const { deps, record } = makeDeps({ update: async () => null })
      const out = await updateStorage(deps, { userId: 'u1', orgId: 'o1', id: 'x', input: { title: 'New' } })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
      expect(record).not.toHaveBeenCalled()
    })

    it('gates egress-credit billing before the existence check (402 over 404)', async () => {
      edition(PRO) // lacks quota_store
      const update = vi.fn(async () => null)
      const { deps } = makeDeps({ update })
      const out = await updateStorage(deps, {
        userId: 'u1',
        orgId: 'o1',
        id: 'x',
        input: { egressCreditBillingEnabled: true },
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(402)
        expect(out.error.meta.reason).toBe('FEATURE_NOT_AVAILABLE')
        expect(out.error.meta.metadata).toEqual({ feature: 'quota_store' })
      }
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('deleteStorage', () => {
    it('deletes and records activity with the storage name', async () => {
      const del = vi.fn(async () => 'ok' as const)
      const { deps, record } = makeDeps({ get: async () => sampleStorage, delete: del })
      const out = await deleteStorage(deps, { userId: 'u1', orgId: 'o1', id: 'st-1' })
      expect(out).toEqual({ ok: true })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'storage_delete', targetId: 'st-1', targetName: 'My S3' }),
      )
    })

    it('returns not_found for a missing storage', async () => {
      const { deps, record } = makeDeps({ get: async () => null, delete: async () => 'not_found' })
      const out = await deleteStorage(deps, { userId: 'u1', orgId: 'o1', id: 'x' })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
      expect(record).not.toHaveBeenCalled()
    })

    it('returns in_use when the storage is referenced', async () => {
      const { deps, record } = makeDeps({ get: async () => sampleStorage, delete: async () => 'in_use' })
      const out = await deleteStorage(deps, { userId: 'u1', orgId: 'o1', id: 'st-1' })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(409)
        expect(out.error.message).toBe('Storage is referenced by existing files')
      }
      expect(record).not.toHaveBeenCalled()
    })
  })
})
