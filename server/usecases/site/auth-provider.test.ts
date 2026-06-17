import { FREE_SOCIAL_LOGIN_LIMIT } from '@shared/constants'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseBindingRepo, SystemOption, SystemOptionsRepo } from '../ports'
import {
  type AuthProviderDeps,
  deleteAuthProvider,
  listAuthProviders,
  listPublicAuthProviders,
  type UpsertProviderInput,
  upsertAuthProvider,
} from './auth-provider'
import { loadBindingState } from './licensing'

// loadBindingState derives features from a signed certificate — out of scope for
// a usecase unit test. Mock it so each case feeds a chosen edition; the real
// (pure) hasFeature then runs against it. The full cert→features→gate path is
// covered by auth-providers.integration.test.ts.
vi.mock('./licensing', () => ({ loadBindingState: vi.fn() }))

const COMMUNITY: BindingState = { bound: false } // lacks social_login_unlimited
const PRO: BindingState = { bound: true, active: true, edition: 'pro' } // has social_login_unlimited

const edition = (state: BindingState) => vi.mocked(loadBindingState).mockResolvedValue(state)

const githubInput: UpsertProviderInput = {
  type: 'builtin',
  clientId: 'client-id-123',
  clientSecret: 'super-secret-value',
  enabled: true,
}

const oidcInput: UpsertProviderInput = {
  type: 'oidc',
  clientId: 'oidc-client-id',
  clientSecret: 'oidc-secret-value',
  enabled: true,
  discoveryUrl: 'https://accounts.example.com/.well-known/openid-configuration',
  scopes: ['openid', 'email', 'profile'],
}

function row(config: Record<string, unknown>): { key: string; value: string } {
  return { key: `oauth_provider_${config.providerId}`, value: JSON.stringify(config) }
}

function makeDeps(systemOptions: Partial<SystemOptionsRepo> = {}) {
  const set = vi.fn(async () => {})
  const del = vi.fn(async () => {})
  const repo: SystemOptionsRepo = {
    list: async () => [],
    listPublic: async () => [],
    get: async () => null,
    getValue: async () => null,
    listByKeyLike: async () => [],
    set,
    delete: del,
    ...systemOptions,
  }
  const deps: AuthProviderDeps = {
    systemOptions: repo,
    licenseBinding: {} as LicenseBindingRepo, // unused — loadBindingState is mocked
  }
  return { deps, set, del }
}

beforeEach(() => vi.clearAllMocks())

describe('auth-provider usecase', () => {
  describe('listPublicAuthProviders', () => {
    it('returns only enabled providers with metadata, no secrets', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [
          row({ providerId: 'github', type: 'builtin', clientId: 'a', clientSecret: 's', enabled: true }),
          row({ providerId: 'google', type: 'builtin', clientId: 'b', clientSecret: 's', enabled: false }),
        ],
      })
      const out = await listPublicAuthProviders(deps)
      expect(out.items).toEqual([{ providerId: 'github', type: 'builtin', name: 'GitHub', icon: 'github' }])
      expect(out.items[0]).not.toHaveProperty('clientSecret')
    })

    it('falls back to providerId for name and icon of an unknown OIDC provider', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [
          row({ providerId: 'my-custom-oidc', type: 'oidc', clientId: 'a', clientSecret: 's', enabled: true }),
        ],
      })
      const out = await listPublicAuthProviders(deps)
      expect(out.items).toEqual([
        { providerId: 'my-custom-oidc', type: 'oidc', name: 'my-custom-oidc', icon: 'my-custom-oidc' },
      ])
    })

    it('skips rows whose value fails to parse', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [{ key: 'oauth_provider_bad', value: 'not-json' }],
      })
      expect(await listPublicAuthProviders(deps)).toEqual({ items: [] })
    })

    it('returns empty when nothing is configured', async () => {
      const { deps } = makeDeps()
      expect(await listPublicAuthProviders(deps)).toEqual({ items: [] })
    })
  })

  describe('listAuthProviders', () => {
    it('returns all configs, enabled or not, with masked secrets', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [
          row({
            providerId: 'github',
            type: 'builtin',
            clientId: 'a',
            clientSecret: 'super-secret-value',
            enabled: true,
          }),
          row({ providerId: 'google', type: 'builtin', clientId: 'b', clientSecret: 's', enabled: false }),
        ],
      })
      const out = await listAuthProviders(deps)
      expect(out.items).toHaveLength(2)
      expect(out.items[0].clientSecret).toMatch(/^\*+alue$/)
      expect(out.items[0].clientSecret).not.toBe('super-secret-value')
    })

    it('masks a short secret entirely with four asterisks', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [
          row({ providerId: 'github', type: 'builtin', clientId: 'a', clientSecret: 'abc', enabled: true }),
        ],
      })
      const out = await listAuthProviders(deps)
      expect(out.items[0].clientSecret).toBe('****')
    })

    it('skips rows whose value fails to parse', async () => {
      const { deps } = makeDeps({
        listByKeyLike: async () => [{ key: 'oauth_provider_bad', value: '{' }],
      })
      expect(await listAuthProviders(deps)).toEqual({ items: [] })
    })
  })

  describe('upsertAuthProvider', () => {
    it('creates a new builtin provider under the free limit and stores it', async () => {
      edition(COMMUNITY)
      const { deps, set } = makeDeps({ get: async () => null, listByKeyLike: async () => [] })
      const out = await upsertAuthProvider(deps, 'github', githubInput)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.config.providerId).toBe('github')
        expect(out.config.type).toBe('builtin')
        expect(out.config.clientSecret).toMatch(/^\*+alue$/)
      }
      expect(set).toHaveBeenCalledWith(
        'oauth_provider_github',
        JSON.stringify({ providerId: 'github', ...githubInput }),
        false,
      )
    })

    it('creates a new OIDC provider with a discoveryUrl', async () => {
      edition(COMMUNITY)
      const { deps, set } = makeDeps({ get: async () => null, listByKeyLike: async () => [] })
      const out = await upsertAuthProvider(deps, 'my-oidc', oidcInput)
      expect(out.ok).toBe(true)
      if (out.ok) {
        expect(out.config.type).toBe('oidc')
        expect(out.config.discoveryUrl).toBe(oidcInput.discoveryUrl)
        expect(out.config.scopes).toEqual(oidcInput.scopes)
      }
      expect(set).toHaveBeenCalledOnce()
    })

    it('updates an existing provider and does not consult the license', async () => {
      const existing: SystemOption = {
        key: 'oauth_provider_github',
        value: JSON.stringify({ providerId: 'github', ...githubInput }),
        public: false,
      }
      const { deps, set } = makeDeps({ get: async () => existing })
      const out = await upsertAuthProvider(deps, 'github', { ...githubInput, clientId: 'new-client-id' })
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.config.clientId).toBe('new-client-id')
      expect(set).toHaveBeenCalledOnce()
      expect(loadBindingState).not.toHaveBeenCalled() // free limit never checked on update
    })

    it('returns a 400 invalid-id error for a malformed provider id and never writes', async () => {
      const { deps, set } = makeDeps()
      const out = await upsertAuthProvider(deps, 'Not_Valid', githubInput)
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Provider ID must contain only lowercase letters, numbers, and hyphens')
      expect(set).not.toHaveBeenCalled()
    })

    it('returns a 400 unknown-builtin error for a builtin id not in the registry', async () => {
      const { deps, set } = makeDeps()
      const out = await upsertAuthProvider(deps, 'not-a-real-provider', githubInput)
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Unknown builtin provider: not-a-real-provider')
      expect(set).not.toHaveBeenCalled()
    })

    it('returns a 400 missing-discovery error for an OIDC provider with no discoveryUrl', async () => {
      const { deps, set } = makeDeps()
      const { discoveryUrl: _omit, ...withoutDiscovery } = oidcInput
      const out = await upsertAuthProvider(deps, 'my-oidc', withoutDiscovery)
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('discoveryUrl is required for OIDC providers')
      expect(set).not.toHaveBeenCalled()
    })

    it('blocks the second provider on the free plan with a 402 feature-blocked error', async () => {
      edition(COMMUNITY)
      const { deps, set } = makeDeps({
        get: async () => null,
        listByKeyLike: async () => [row({ providerId: 'github', enabled: true })],
      })
      const out = await upsertAuthProvider(deps, 'google', { ...githubInput })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(402)
      expect(out.error.meta.reason).toBe('FEATURE_NOT_AVAILABLE')
      expect(out.error.meta.metadata).toEqual({
        feature: 'social_login_unlimited',
        currentCount: '1',
        limit: String(FREE_SOCIAL_LOGIN_LIMIT),
        upgradeUrl: '/settings/billing',
      })
      expect(set).not.toHaveBeenCalled()
    })

    it('allows additional providers with the social_login_unlimited entitlement', async () => {
      edition(PRO)
      const { deps, set } = makeDeps({
        get: async () => null,
        listByKeyLike: async () => [row({ providerId: 'github', enabled: true })],
      })
      const out = await upsertAuthProvider(deps, 'google', { ...githubInput })
      expect(out.ok).toBe(true)
      expect(set).toHaveBeenCalledOnce()
    })
  })

  describe('deleteAuthProvider', () => {
    it('deletes by option key and reports ok', async () => {
      const { deps, del } = makeDeps()
      const out = await deleteAuthProvider(deps, 'github')
      expect(out).toEqual({ ok: true })
      expect(del).toHaveBeenCalledWith('oauth_provider_github')
    })

    it('returns ok even for a provider that does not exist (idempotent)', async () => {
      const { deps, del } = makeDeps()
      const out = await deleteAuthProvider(deps, 'never-configured')
      expect(out).toEqual({ ok: true })
      expect(del).toHaveBeenCalledWith('oauth_provider_never-configured')
    })

    it('returns a 400 invalid-id error for a malformed provider id and never deletes', async () => {
      const { deps, del } = makeDeps()
      const out = await deleteAuthProvider(deps, 'Bad_Id')
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Provider ID must contain only lowercase letters, numbers, and hyphens')
      expect(del).not.toHaveBeenCalled()
    })
  })
})
