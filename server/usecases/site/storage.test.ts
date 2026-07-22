import { FREE_STORAGE_LIMIT } from '@shared/constants'
import type { CreateStorageInput } from '@shared/schemas'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseBindingRepo, StorageRecord, StorageRepo } from '../ports'
import { AppError } from '../ports'
import { loadBindingState } from './licensing'
import {
  createStorage,
  deleteStorage,
  getStorage,
  listStorages,
  type StorageDeps,
  updateStorage,
  updateStorageEgressBilling,
} from './storage'

// loadBindingState derives features from a signed certificate — out of scope for
// a usecase unit test. Mock it so each case feeds a chosen edition; the real
// (pure) hasFeature then runs against it. The full cert→features→gate path is
// covered by storages.integration.test.ts.
vi.mock('./licensing', () => ({ loadBindingState: vi.fn() }))

const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' } // has storages_unlimited, not quota_store
const BUSINESS: BindingState = { bound: true, active: true, edition: 'business' } // has both

const edition = (state: BindingState) => vi.mocked(loadBindingState).mockResolvedValue(state)

const sampleStorage = { id: 'st-1', bucket: 'b' } as StorageRecord

const validInput: CreateStorageInput = {
  bucket: 'b',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  accessKey: 'k',
  secretKey: 's',
} as CreateStorageInput

function makeDeps(storages: Partial<StorageRepo> = {}) {
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
    licenseBinding: {} as LicenseBindingRepo, // unused — loadBindingState is mocked
  }
  return { deps }
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
    it('creates when under the Community limit', async () => {
      edition(COMMUNITY)
      const create = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ count: async () => FREE_STORAGE_LIMIT - 1, create })
      const out = await createStorage(deps, { input: validInput })
      expect(out).toEqual({ ok: true, storage: sampleStorage })
      expect(create).toHaveBeenCalledWith(validInput)
    })

    it('blocks at the Community storage limit without storages_unlimited', async () => {
      edition(COMMUNITY)
      const { deps } = makeDeps({ count: async () => FREE_STORAGE_LIMIT })
      const out = await createStorage(deps, { input: validInput })
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
    })

    it('allows creating past the limit with storages_unlimited', async () => {
      edition(PRO)
      const create = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ count: async () => FREE_STORAGE_LIMIT + 5, create })
      const out = await createStorage(deps, { input: validInput })
      expect(out.ok).toBe(true)
      expect(create).toHaveBeenCalled()
    })

    it('blocks egress-credit billing when quota_store is absent', async () => {
      edition(PRO) // pro has storages_unlimited but not quota_store
      const { deps } = makeDeps({ count: async () => 0 })
      const out = await createStorage(deps, {
        input: { ...validInput, egressCreditBillingEnabled: true },
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(402)
        expect(out.error.meta.reason).toBe('FEATURE_NOT_AVAILABLE')
        expect(out.error.meta.metadata).toEqual({ feature: 'quota_store' })
      }
    })

    it('allows egress-credit billing with quota_store (business)', async () => {
      edition(BUSINESS)
      const create = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ count: async () => 0, create })
      const out = await createStorage(deps, {
        input: { ...validInput, egressCreditBillingEnabled: true },
      })
      expect(out.ok).toBe(true)
    })
  })

  describe('updateStorage', () => {
    it('updates the storage', async () => {
      edition(COMMUNITY)
      const update = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ update })
      const out = await updateStorage(deps, { id: 'st-1', input: { bucket: 'new-b' } })
      expect(out).toEqual({ ok: true, storage: sampleStorage })
      expect(update).toHaveBeenCalledWith('st-1', { bucket: 'new-b' })
    })

    it('returns not_found for a missing storage', async () => {
      edition(COMMUNITY)
      const { deps } = makeDeps({ update: async () => null })
      const out = await updateStorage(deps, { id: 'x', input: { bucket: 'new-b' } })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
    })

    it('gates egress-credit billing before the existence check (402 over 404)', async () => {
      edition(PRO) // lacks quota_store
      const update = vi.fn(async () => null)
      const { deps } = makeDeps({ update })
      const out = await updateStorage(deps, {
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

  describe('updateStorageEgressBilling', () => {
    it('updates egress billing fields', async () => {
      edition(BUSINESS)
      const update = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ get: async () => sampleStorage, update })
      const out = await updateStorageEgressBilling(deps, {
        id: 'st-1',
        input: { enabled: true, unitBytes: 1024, creditsPerUnit: 2 },
      })
      expect(out).toEqual({ ok: true, storage: sampleStorage })
      expect(update).toHaveBeenCalledWith('st-1', {
        egressCreditBillingEnabled: true,
        egressCreditUnitBytes: 1024,
        egressCreditPerUnit: 2,
      })
    })

    it('blocks enabling egress billing without quota_store', async () => {
      edition(PRO)
      const update = vi.fn(async () => sampleStorage)
      const { deps } = makeDeps({ get: async () => sampleStorage, update })
      const out = await updateStorageEgressBilling(deps, {
        id: 'st-1',
        input: { enabled: true, unitBytes: 1024, creditsPerUnit: 2 },
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

    it('returns not_found for a missing storage when billing is disabled', async () => {
      edition(PRO)
      const { deps } = makeDeps({ update: async () => null })
      const out = await updateStorageEgressBilling(deps, {
        id: 'missing',
        input: { enabled: false, unitBytes: 1024, creditsPerUnit: 2 },
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
    })

    it('returns not_found before quota_store gating for a missing storage when billing is enabled', async () => {
      edition(PRO)
      const update = vi.fn(async () => null)
      const { deps } = makeDeps({ get: async () => null, update })
      const out = await updateStorageEgressBilling(deps, {
        id: 'missing',
        input: { enabled: true, unitBytes: 1024, creditsPerUnit: 2 },
      })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('deleteStorage', () => {
    it('deletes the storage', async () => {
      const del = vi.fn(async () => 'ok' as const)
      const { deps } = makeDeps({ get: async () => sampleStorage, delete: del })
      const out = await deleteStorage(deps, { id: 'st-1' })
      expect(out).toEqual({ ok: true })
    })

    it('returns not_found for a missing storage', async () => {
      const { deps } = makeDeps({ get: async () => null, delete: async () => 'not_found' })
      const out = await deleteStorage(deps, { id: 'x' })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(404)
        expect(out.error.message).toBe('Storage not found')
      }
    })

    it('returns in_use when the storage is referenced', async () => {
      const { deps } = makeDeps({ get: async () => sampleStorage, delete: async () => 'in_use' })
      const out = await deleteStorage(deps, { id: 'st-1' })
      expect(out.ok).toBe(false)
      if (!out.ok) {
        expect(out.error).toBeInstanceOf(AppError)
        expect(out.error.httpStatus).toBe(409)
        expect(out.error.message).toBe('Storage is referenced by existing files')
      }
    })
  })
})
