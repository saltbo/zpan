import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '@shared/captcha'
import { SignupMode } from '@shared/constants'
import type { BindingState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppVersion } from '../version'
import { loadBindingState } from './licensing'
import type { ActivityRepo, ChangelogProvider, InstanceRepo, SystemOption, SystemOptionsRepo } from './ports'
import {
  deleteSystemOption,
  getChangelog,
  getSystemOption,
  listSystemOptions,
  resolveInstanceInfo,
  type SystemDeps,
  setSystemOption,
} from './system'

// loadBindingState verifies a signed certificate — out of scope for a usecase
// unit test. Mock it so each case feeds a chosen edition; the real (pure)
// hasFeature then runs against it (mirrors storage.test.ts).
vi.mock('./licensing', () => ({ loadBindingState: vi.fn() }))
vi.mock('../version', () => ({ getAppVersion: vi.fn(() => 'test-version'), getAppCommit: vi.fn(() => null) }))

const COMMUNITY: BindingState = { bound: false }
const PRO: BindingState = { bound: true, active: true, edition: 'pro' } // has open_registration

const edition = (state: BindingState) => vi.mocked(loadBindingState).mockResolvedValue(state)

const runtime = { runtime: 'node', platform: 'node' } as const

function option(over: Partial<SystemOption> = {}): SystemOption {
  return { key: 'site_name', value: 'ZPan', public: true, ...over }
}

function makeDeps(systemOptions: Partial<SystemOptionsRepo> = {}, over: Partial<SystemDeps> = {}) {
  const record = vi.fn(async () => {})
  const repo: SystemOptionsRepo = {
    list: async () => [],
    listPublic: async () => [],
    get: async () => null,
    getValue: async () => null,
    listByKeyLike: async () => [],
    set: async () => {},
    delete: async () => {},
    ...systemOptions,
  }
  const deps: SystemDeps = {
    systemOptions: repo,
    instance: {
      getOrCreateInstanceId: async () => 'inst-1',
      getInstanceDisplayName: async () => 'My ZPan',
    } as InstanceRepo,
    changelog: { fetchChangelog: async () => ({ latestVersion: null, markdown: '' }) } as ChangelogProvider,
    activity: { record } as unknown as ActivityRepo,
    licenseBinding: {} as SystemDeps['licenseBinding'], // unused — loadBindingState is mocked
    ...over,
  }
  return { deps, record, repo }
}

beforeEach(() => vi.clearAllMocks())

describe('system usecase', () => {
  describe('resolveInstanceInfo', () => {
    it('uses the stored site origin when present', async () => {
      const { deps } = makeDeps({ getValue: async () => 'https://files.example.com' })
      const info = await resolveInstanceInfo(deps, {
        requestUrl: 'https://req.example.com/api/system/instance',
        runtime,
      })
      expect(info).toMatchObject({ id: 'inst-1', name: 'My ZPan', url: 'https://files.example.com', runtime: 'node' })
      expect(info.version).toBe('test-version')
    })

    it('falls back to the request origin when no site origin is stored', async () => {
      const { deps } = makeDeps({ getValue: async () => null })
      const info = await resolveInstanceInfo(deps, {
        requestUrl: 'https://req.example.com/api/system/instance',
        runtime,
      })
      expect(info.url).toBe('https://req.example.com')
    })
  })

  describe('getChangelog', () => {
    it('reports an available update when the latest version is newer', async () => {
      vi.mocked(getAppVersion).mockReturnValueOnce('1.0.0')
      const fetchChangelog = vi.fn(async () => ({ latestVersion: '99.0.0', markdown: '## notes' }))
      const { deps } = makeDeps({}, { changelog: { fetchChangelog } as ChangelogProvider })
      const out = await getChangelog(deps, { now: 123, force: true })
      expect(fetchChangelog).toHaveBeenCalledWith(123, { force: true })
      expect(out).toEqual({
        currentVersion: '1.0.0',
        latestVersion: '99.0.0',
        updateAvailable: true,
        markdown: '## notes',
      })
    })

    it('is not an update when the latest version is unparseable', async () => {
      const { deps } = makeDeps(
        {},
        { changelog: { fetchChangelog: async () => ({ latestVersion: null, markdown: '' }) } as ChangelogProvider },
      )
      const out = await getChangelog(deps, { now: 0, force: false })
      expect(out.updateAvailable).toBe(false)
      expect(out.latestVersion).toBeNull()
    })
  })

  describe('listSystemOptions', () => {
    it('returns all options for an admin', async () => {
      const all = [option(), option({ key: 'smtp_password', public: false })]
      const { deps } = makeDeps({ list: async () => all, listPublic: async () => [all[0]] })
      expect(await listSystemOptions(deps, { isAdmin: true })).toEqual({ items: all, total: 2 })
    })

    it('returns only public options for a non-admin', async () => {
      const all = [option()]
      const { deps } = makeDeps({
        list: async () => [...all, option({ key: 'x', public: false })],
        listPublic: async () => all,
      })
      expect(await listSystemOptions(deps, { isAdmin: false })).toEqual({ items: all, total: 1 })
    })
  })

  describe('getSystemOption', () => {
    it('returns not_found when the key is absent', async () => {
      const { deps } = makeDeps({ get: async () => null })
      expect(await getSystemOption(deps, { key: 'missing', isAdmin: true })).toEqual({ ok: false, reason: 'not_found' })
    })

    it('returns the option to anyone when it is public', async () => {
      const { deps } = makeDeps({ get: async () => option({ public: true }) })
      const out = await getSystemOption(deps, { key: 'site_name', isAdmin: false })
      expect(out).toEqual({ ok: true, option: { key: 'site_name', value: 'ZPan', public: true } })
    })

    it('forbids a non-admin from reading a private option', async () => {
      const { deps } = makeDeps({ get: async () => option({ key: 'smtp_password', public: false }) })
      expect(await getSystemOption(deps, { key: 'smtp_password', isAdmin: false })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })

    it('lets an admin read a private option', async () => {
      const { deps } = makeDeps({ get: async () => option({ key: 'smtp_password', value: 's', public: false }) })
      const out = await getSystemOption(deps, { key: 'smtp_password', isAdmin: true })
      expect(out).toEqual({ ok: true, option: { key: 'smtp_password', value: 's', public: false } })
    })
  })

  describe('setSystemOption', () => {
    const base = { userId: 'u1', orgId: 'o1' }

    it('creates a new option and records activity (201 path)', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps, record } = makeDeps({ get: async () => null, set })
      const out = await setSystemOption(deps, { ...base, key: 'site_name', value: 'ZPan', public: true })
      expect(out).toEqual({ ok: true, created: true, option: { key: 'site_name', value: 'ZPan', public: true } })
      expect(set).toHaveBeenCalledWith('site_name', 'ZPan', true)
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'system_option_set', targetName: 'site_name', orgId: 'o1', userId: 'u1' }),
      )
    })

    it('preserves the existing public flag when omitted (200 path)', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => option({ value: 'old', public: true }), set })
      const out = await setSystemOption(deps, { ...base, key: 'site_name', value: 'new' })
      expect(out).toEqual({ ok: true, created: false, option: { key: 'site_name', value: 'new', public: true } })
      expect(set).toHaveBeenCalledWith('site_name', 'new', true)
    })

    it('defaults a brand-new option to private when visibility is omitted', async () => {
      edition(COMMUNITY)
      const { deps } = makeDeps({ get: async () => null })
      const out = await setSystemOption(deps, { ...base, key: 'site_name', value: 'ZPan' })
      expect(out).toMatchObject({ ok: true, created: true, option: { public: false } })
    })

    it('blocks opening signup without open_registration', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps, record } = makeDeps({ set })
      const out = await setSystemOption(deps, { ...base, key: 'auth_signup_mode', value: SignupMode.OPEN })
      expect(out).toEqual({ ok: false, reason: 'feature_blocked', feature: 'open_registration' })
      expect(set).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it('allows opening signup with open_registration', async () => {
      edition(PRO)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => null, set })
      const out = await setSystemOption(deps, { ...base, key: 'auth_signup_mode', value: SignupMode.OPEN })
      expect(out.ok).toBe(true)
      expect(set).toHaveBeenCalledWith('auth_signup_mode', SignupMode.OPEN, false)
    })

    it('does not gate non-open signup modes', async () => {
      edition(COMMUNITY)
      const { deps } = makeDeps({ get: async () => null })
      const out = await setSystemOption(deps, { ...base, key: 'auth_signup_mode', value: SignupMode.INVITE_ONLY })
      expect(out.ok).toBe(true)
      expect(loadBindingState).not.toHaveBeenCalled()
    })

    it('forces captcha public keys public regardless of the request', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => null, set, listByKeyLike: async () => [] })
      const out = await setSystemOption(deps, { ...base, key: CAPTCHA_SITE_KEY_KEY, value: 'sk', public: false })
      expect(out).toMatchObject({ ok: true, option: { public: true } })
      expect(set).toHaveBeenCalledWith(CAPTCHA_SITE_KEY_KEY, 'sk', true)
    })

    it('forces captcha private keys private regardless of the request', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => null, set, listByKeyLike: async () => [] })
      const out = await setSystemOption(deps, {
        ...base,
        key: CAPTCHA_SECRET_OPTION_KEY,
        value: 'secret',
        public: true,
      })
      expect(out).toMatchObject({ ok: true, option: { public: false } })
      expect(set).toHaveBeenCalledWith(CAPTCHA_SECRET_OPTION_KEY, 'secret', false)
    })

    it('rejects enabling captcha before the keys exist', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      // listByKeyLike returns no captcha config; enabling makes readCaptchaConfig throw.
      const { deps } = makeDeps({ set, listByKeyLike: async () => [] })
      const out = await setSystemOption(deps, { ...base, key: CAPTCHA_ENABLED_KEY, value: 'true' })
      expect(out.ok).toBe(false)
      expect(out).toMatchObject({ reason: 'invalid' })
      expect(set).not.toHaveBeenCalled()
    })

    it('allows an invalid captcha piece while captcha is disabled', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      // Provider set but captcha not enabled → readCaptchaConfig returns null, no error surfaced.
      const { deps } = makeDeps({ get: async () => null, set, listByKeyLike: async () => [] })
      const out = await setSystemOption(deps, { ...base, key: CAPTCHA_PROVIDER_KEY, value: 'cloudflare-turnstile' })
      expect(out.ok).toBe(true)
      expect(set).toHaveBeenCalledWith(CAPTCHA_PROVIDER_KEY, 'cloudflare-turnstile', true)
    })

    it('surfaces an out-of-range captcha min score only when enabled', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({
        set,
        listByKeyLike: async () => [
          { key: CAPTCHA_ENABLED_KEY, value: 'true' },
          { key: CAPTCHA_PROVIDER_KEY, value: 'cloudflare-turnstile' },
          { key: CAPTCHA_SITE_KEY_KEY, value: 'sk' },
          { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret' },
        ],
      })
      const out = await setSystemOption(deps, { ...base, key: CAPTCHA_MIN_SCORE_KEY, value: '5' })
      expect(out).toMatchObject({ ok: false, reason: 'invalid' })
      expect(set).not.toHaveBeenCalled()
    })

    it('rejects a non-positive default_org_quota', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ set })
      for (const value of ['0', '-1', '1.5', 'abc']) {
        const out = await setSystemOption(deps, { ...base, key: 'default_org_quota', value })
        expect(out).toEqual({
          ok: false,
          reason: 'invalid',
          message: 'Default organization quota must be a positive number',
        })
      }
      expect(set).not.toHaveBeenCalled()
    })

    it('accepts a positive default_team_quota', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => null, set })
      const out = await setSystemOption(deps, { ...base, key: 'default_team_quota', value: '100' })
      expect(out.ok).toBe(true)
      expect(set).toHaveBeenCalledWith('default_team_quota', '100', false)
    })

    it('trims and accepts zero for the monthly traffic quota', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ get: async () => null, set })
      const created = await setSystemOption(deps, {
        ...base,
        key: 'default_org_monthly_traffic_quota',
        value: ' 1024 ',
      })
      expect(created).toMatchObject({ ok: true, option: { value: '1024' } })
      expect(set).toHaveBeenCalledWith('default_org_monthly_traffic_quota', '1024', false)

      const zero = await setSystemOption(deps, { ...base, key: 'default_org_monthly_traffic_quota', value: '0' })
      expect(zero).toMatchObject({ ok: true, option: { value: '0' } })
    })

    it('rejects invalid monthly traffic quota values', async () => {
      edition(COMMUNITY)
      const set = vi.fn(async () => {})
      const { deps } = makeDeps({ set })
      for (const value of ['', '   ', '-1', '1.5', 'abc']) {
        const out = await setSystemOption(deps, { ...base, key: 'default_org_monthly_traffic_quota', value })
        expect(out).toMatchObject({ ok: false, reason: 'invalid' })
      }
      expect(set).not.toHaveBeenCalled()
    })
  })

  describe('deleteSystemOption', () => {
    it('deletes the key and records activity', async () => {
      const del = vi.fn(async () => {})
      const { deps, record } = makeDeps({ delete: del })
      const out = await deleteSystemOption(deps, { userId: 'u1', orgId: 'o1', key: 'site_name' })
      expect(out).toEqual({ key: 'site_name', deleted: true })
      expect(del).toHaveBeenCalledWith('site_name')
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'system_option_delete', targetName: 'site_name', orgId: 'o1', userId: 'u1' }),
      )
    })
  })
})
