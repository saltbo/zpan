import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppVersion } from '../../version'
import type { ChangelogProvider, InstanceRepo, SystemOptionsRepo } from '../ports'
import { getChangelog, resolveInstanceInfo, type SystemDeps } from './system'

vi.mock('../../version', () => ({ getAppVersion: vi.fn(() => 'test-version'), getAppCommit: vi.fn(() => null) }))

const runtime = { runtime: 'node', platform: 'node' } as const

function makeDeps(systemOptions: Partial<SystemOptionsRepo> = {}, over: Partial<SystemDeps> = {}): SystemDeps {
  return {
    systemOptions: {
      get: async () => null,
      getValue: async () => null,
      getMany: async () => [],
      listByPrefix: async () => [],
      set: async () => {},
      setMany: async () => {},
      delete: async () => {},
      ...systemOptions,
    },
    instance: {
      getOrCreateInstanceId: async () => 'inst-1',
      getInstanceDisplayName: async () => 'My ZPan',
    } as InstanceRepo,
    changelog: { fetchChangelog: async () => ({ latestVersion: null, markdown: '' }) } as ChangelogProvider,
    ...over,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('system usecase', () => {
  describe('resolveInstanceInfo', () => {
    it('uses the stored site origin when present', async () => {
      const deps = makeDeps({ getValue: async () => 'https://files.example.com' })
      const info = await resolveInstanceInfo(deps, {
        requestUrl: 'https://req.example.com/api/system/instance',
        runtime,
      })
      expect(info).toMatchObject({ id: 'inst-1', name: 'My ZPan', url: 'https://files.example.com', runtime: 'node' })
      expect(info.version).toBe('test-version')
    })

    it('falls back to the request origin when no site origin is stored', async () => {
      const deps = makeDeps()
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
      const deps = makeDeps({}, { changelog: { fetchChangelog } as ChangelogProvider })
      const out = await getChangelog(deps, { now: 123, force: true })
      expect(fetchChangelog).toHaveBeenCalledWith(123, { force: true })
      expect(out).toEqual({
        currentVersion: '1.0.0',
        latestVersion: '99.0.0',
        updateAvailable: true,
        markdown: '## notes',
      })
    })

    it('is not an update when the latest version is absent', async () => {
      const deps = makeDeps()
      const out = await getChangelog(deps, { now: 0, force: false })
      expect(out.updateAvailable).toBe(false)
      expect(out.latestVersion).toBeNull()
    })
  })
})
