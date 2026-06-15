import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CfConflictError,
  type CfHostnameStatus,
  type CfHostnamesProvider,
  type ImageHostingConfigRecord,
  type ImageHostingConfigRepo,
} from '../ports'
import {
  type CfSettings,
  deleteImageHostingConfig,
  getImageHostingConfig,
  type ImageHostingConfigDeps,
  putImageHostingConfig,
} from './config'

const CF_ON: CfSettings = { isConfigured: true, appHost: null }
const CF_OFF: CfSettings = { isConfigured: false, appHost: null }

function makeConfig(over: Partial<ImageHostingConfigRecord> = {}): ImageHostingConfigRecord {
  return {
    orgId: 'o1',
    customDomain: null,
    cfHostnameId: null,
    domainVerifiedAt: null,
    refererAllowlist: null,
    createdAt: new Date(1000),
    updatedAt: new Date(1000),
    ...over,
  }
}

const activeStatus: CfHostnameStatus = { status: 'active', ssl_status: 'active' }
const pendingStatus: CfHostnameStatus = { status: 'pending', ssl_status: 'initializing' }

const notImpl = () => {
  throw new Error('not implemented')
}

function makeDeps(
  over: { imageHostingConfigs?: Partial<ImageHostingConfigRepo>; cfHostnames?: Partial<CfHostnamesProvider> } = {},
): ImageHostingConfigDeps {
  return {
    imageHostingConfigs: {
      getByOrg: async () => null,
      create: async () => {},
      update: async () => {},
      delete: async () => {},
      ...over.imageHostingConfigs,
    },
    cfHostnames: {
      register: async () => ({ id: 'cf-new' }),
      getStatus: notImpl,
      delete: async () => {},
      ...over.cfHostnames,
    },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('image-hosting-config usecase', () => {
  describe('getImageHostingConfig', () => {
    it('returns null when no config row exists', async () => {
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null } })
      expect(await getImageHostingConfig(deps, 'o1', CF_ON)).toBeNull()
    })

    it('returns the row unchanged when no custom domain', async () => {
      const row = makeConfig()
      const getStatus = vi.fn(notImpl)
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => row }, cfHostnames: { getStatus } })
      expect(await getImageHostingConfig(deps, 'o1', CF_ON)).toBe(row)
      expect(getStatus).not.toHaveBeenCalled()
    })

    it('does NOT call CF when the domain is already verified', async () => {
      const row = makeConfig({ customDomain: 'img.x.com', cfHostnameId: 'cf-1', domainVerifiedAt: new Date(500) })
      const getStatus = vi.fn(notImpl)
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => row }, cfHostnames: { getStatus } })
      const out = await getImageHostingConfig(deps, 'o1', CF_ON)
      expect(out?.domainVerifiedAt).toEqual(new Date(500))
      expect(getStatus).not.toHaveBeenCalled()
    })

    it('does NOT call CF when CF is not configured (stays pending)', async () => {
      const row = makeConfig({ customDomain: 'img.x.com', cfHostnameId: 'cf-1', domainVerifiedAt: null })
      const getStatus = vi.fn(notImpl)
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => row }, cfHostnames: { getStatus } })
      const out = await getImageHostingConfig(deps, 'o1', CF_OFF)
      expect(out?.domainVerifiedAt).toBeNull()
      expect(getStatus).not.toHaveBeenCalled()
    })

    it('lazily verifies and persists when CF getStatus returns active', async () => {
      const row = makeConfig({ customDomain: 'img.x.com', cfHostnameId: 'cf-pending', domainVerifiedAt: null })
      const update = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => row, update },
        cfHostnames: { getStatus: async () => activeStatus },
      })
      const out = await getImageHostingConfig(deps, 'o1', CF_ON)
      expect(out?.domainVerifiedAt).toBeInstanceOf(Date)
      expect(update).toHaveBeenCalledWith('o1', { domainVerifiedAt: expect.any(Date) })
    })

    it('stays pending and does not persist when CF getStatus is non-active', async () => {
      const row = makeConfig({ customDomain: 'img.x.com', cfHostnameId: 'cf-pending', domainVerifiedAt: null })
      const update = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => row, update },
        cfHostnames: { getStatus: async () => pendingStatus },
      })
      const out = await getImageHostingConfig(deps, 'o1', CF_ON)
      expect(out?.domainVerifiedAt).toBeNull()
      expect(update).not.toHaveBeenCalled()
    })
  })

  describe('putImageHostingConfig — create (no existing row)', () => {
    it('rejects the app default host before any DB or CF work', async () => {
      const getByOrg = vi.fn(async () => null)
      const create = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg, create } })
      const out = await putImageHostingConfig(
        deps,
        'o1',
        { enabled: true, customDomain: 'zpan.example.com' },
        { isConfigured: true, appHost: 'zpan.example.com' },
      )
      expect(out).toEqual({ ok: false, reason: 'app_host', status: 400 })
      expect(getByOrg).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    })

    it('creates a no-domain config and returns enabled with null domain', async () => {
      const create = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null, create } })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true }, CF_OFF)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.config.customDomain).toBeNull()
        expect(out.config.cfHostnameId).toBeNull()
        expect(out.config.domainVerifiedAt).toBeNull()
      }
      expect(create).toHaveBeenCalledWith({
        orgId: 'o1',
        customDomain: null,
        cfHostnameId: null,
        refererAllowlist: null,
      })
    })

    it('registers a CF hostname when CF is configured and stores cfHostnameId', async () => {
      const register = vi.fn(async () => ({ id: 'cf-123' }))
      const create = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null, create }, cfHostnames: { register } })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'img.cf.com' }, CF_ON)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.cfHostnameId).toBe('cf-123')
      expect(register).toHaveBeenCalledWith('img.cf.com')
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ customDomain: 'img.cf.com', cfHostnameId: 'cf-123' }),
      )
    })

    it('does not call CF register when CF is not configured (domain stays pending)', async () => {
      const register = vi.fn(async () => ({ id: 'cf-x' }))
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null }, cfHostnames: { register } })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'img.noenv.com' }, CF_OFF)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.cfHostnameId).toBeNull()
      expect(register).not.toHaveBeenCalled()
    })

    it('serializes refererAllowlist to JSON on create', async () => {
      const create = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => null, create } })
      const out = await putImageHostingConfig(
        deps,
        'o1',
        { enabled: true, refererAllowlist: ['https://a.com', 'https://b.com'] },
        CF_OFF,
      )
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.refererAllowlist).toBe(JSON.stringify(['https://a.com', 'https://b.com']))
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ refererAllowlist: JSON.stringify(['https://a.com', 'https://b.com']) }),
      )
    })

    it('maps a CF conflict to domain_conflict 409', async () => {
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => null },
        cfHostnames: {
          register: async () => {
            throw new CfConflictError('taken')
          },
        },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'taken.com' }, CF_ON)
      expect(out).toEqual({ ok: false, reason: 'domain_conflict', status: 409 })
    })

    it('propagates a non-conflict CF register error', async () => {
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => null },
        cfHostnames: {
          register: async () => {
            throw new Error('CF 500')
          },
        },
      })
      await expect(
        putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'img.err.com' }, CF_ON),
      ).rejects.toThrow('CF 500')
    })

    it('maps a DB UNIQUE violation on insert to domain_conflict 409', async () => {
      const deps = makeDeps({
        imageHostingConfigs: {
          getByOrg: async () => null,
          create: async () => {
            throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: image_hosting_configs.custom_domain')
          },
        },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'dup.com' }, CF_OFF)
      expect(out).toEqual({ ok: false, reason: 'domain_conflict', status: 409 })
    })
  })

  describe('putImageHostingConfig — update (existing row)', () => {
    it('changing the domain deletes the old CF hostname then registers the new one', async () => {
      const existing = makeConfig({ customDomain: 'old.com', cfHostnameId: 'cf-old' })
      const order: string[] = []
      const cfDelete = vi.fn(async () => {
        order.push('delete')
      })
      const register = vi.fn(async () => {
        order.push('register')
        return { id: 'cf-new-456' }
      })
      const update = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, update },
        cfHostnames: { delete: cfDelete, register },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'new.com' }, CF_ON)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.config.customDomain).toBe('new.com')
        expect(out.config.cfHostnameId).toBe('cf-new-456')
        expect(out.config.domainVerifiedAt).toBeNull()
        expect(out.config.createdAt).toEqual(existing.createdAt)
      }
      expect(order).toEqual(['delete', 'register'])
    })

    it('CF delete failure on domain change is best-effort: continues and registers', async () => {
      const existing = makeConfig({ customDomain: 'old.warn.com', cfHostnameId: 'cf-warn' })
      const register = vi.fn(async () => ({ id: 'cf-new-warn' }))
      const update = vi.fn(async () => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, update },
        cfHostnames: {
          delete: async () => {
            throw new Error('CF 403')
          },
          register,
        },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'new.warn.com' }, CF_ON)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.cfHostnameId).toBe('cf-new-warn')
      expect(register).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })

    it('propagates a non-conflict CF register error on the update path', async () => {
      const existing = makeConfig({ customDomain: 'old.com', cfHostnameId: 'cf-old' })
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing },
        cfHostnames: {
          delete: async () => {},
          register: async () => {
            throw new Error('CF 500')
          },
        },
      })
      await expect(
        putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'new.com' }, CF_ON),
      ).rejects.toThrow('CF 500')
    })

    it('maps a DB UNIQUE violation on update to domain_conflict 409', async () => {
      const existing = makeConfig({ customDomain: 'other.com' })
      const deps = makeDeps({
        imageHostingConfigs: {
          getByOrg: async () => existing,
          update: async () => {
            throw new Error('unique constraint')
          },
        },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'claimed.com' }, CF_OFF)
      expect(out).toEqual({ ok: false, reason: 'domain_conflict', status: 409 })
    })

    it('clears the domain (null) → no CF register, domainVerifiedAt null', async () => {
      const existing = makeConfig({ customDomain: 'old.com', cfHostnameId: 'cf-old', domainVerifiedAt: new Date(9) })
      const cfDelete = vi.fn(async () => {})
      const register = vi.fn(async () => ({ id: 'x' }))
      const update = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, update },
        cfHostnames: { delete: cfDelete, register },
      })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: null }, CF_ON)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.config.customDomain).toBeNull()
        expect(out.config.cfHostnameId).toBeNull()
        expect(out.config.domainVerifiedAt).toBeNull()
      }
      expect(cfDelete).toHaveBeenCalledTimes(1)
      expect(register).not.toHaveBeenCalled()
    })

    it('preserves the existing refererAllowlist when the body omits it (unchanged domain)', async () => {
      const existing = makeConfig({ customDomain: 'keep.com', refererAllowlist: JSON.stringify(['https://keep.com']) })
      const update = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => existing, update } })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, customDomain: 'keep.com' }, CF_OFF)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.refererAllowlist).toBe(JSON.stringify(['https://keep.com']))
      expect(update).toHaveBeenCalledWith(
        'o1',
        expect.objectContaining({ refererAllowlist: JSON.stringify(['https://keep.com']) }),
      )
    })

    it('clears the refererAllowlist when the body sets it to null', async () => {
      const existing = makeConfig({ refererAllowlist: JSON.stringify(['https://old.com']) })
      const update = vi.fn(async () => {})
      const deps = makeDeps({ imageHostingConfigs: { getByOrg: async () => existing, update } })
      const out = await putImageHostingConfig(deps, 'o1', { enabled: true, refererAllowlist: null }, CF_OFF)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.refererAllowlist).toBeNull()
    })
  })

  describe('deleteImageHostingConfig', () => {
    it('is a no-op when no config row exists', async () => {
      const del = vi.fn(async () => {})
      const cfDelete = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => null, delete: del },
        cfHostnames: { delete: cfDelete },
      })
      await deleteImageHostingConfig(deps, 'o1')
      expect(del).not.toHaveBeenCalled()
      expect(cfDelete).not.toHaveBeenCalled()
    })

    it('deletes the CF hostname (when set) then removes the row', async () => {
      const existing = makeConfig({ customDomain: 'img.del.com', cfHostnameId: 'cf-del' })
      const cfDelete = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, delete: del },
        cfHostnames: { delete: cfDelete },
      })
      await deleteImageHostingConfig(deps, 'o1')
      expect(cfDelete).toHaveBeenCalledWith('cf-del')
      expect(del).toHaveBeenCalledWith('o1')
    })

    it('removes the row even when CF delete fails (best-effort)', async () => {
      const existing = makeConfig({ customDomain: 'img.fail.com', cfHostnameId: 'cf-fail' })
      const del = vi.fn(async () => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, delete: del },
        cfHostnames: {
          delete: async () => {
            throw new Error('CF 403')
          },
        },
      })
      await deleteImageHostingConfig(deps, 'o1')
      expect(del).toHaveBeenCalledWith('o1')
      warn.mockRestore()
    })

    it('skips the CF call when there is no cfHostnameId', async () => {
      const existing = makeConfig({ customDomain: null, cfHostnameId: null })
      const cfDelete = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const deps = makeDeps({
        imageHostingConfigs: { getByOrg: async () => existing, delete: del },
        cfHostnames: { delete: cfDelete },
      })
      await deleteImageHostingConfig(deps, 'o1')
      expect(cfDelete).not.toHaveBeenCalled()
      expect(del).toHaveBeenCalledWith('o1')
    })
  })
})
