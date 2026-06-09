import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChangelog, parseLatestVersion, resetChangelogCache } from './changelog.js'

describe('parseLatestVersion', () => {
  it('reads the first released version, skipping Unreleased', () => {
    const md = ['# Changelog', '', '## [Unreleased]', '- wip', '', '## [2.7.2] - 2026-06-07', '- fix'].join('\n')
    expect(parseLatestVersion(md)).toBe('2.7.2')
  })

  it('tolerates a leading v and missing brackets', () => {
    expect(parseLatestVersion('## v2.8.0\n- x')).toBe('2.8.0')
    expect(parseLatestVersion('### 3.0.1\n- x')).toBe('3.0.1')
  })

  it('returns null when no version heading is present', () => {
    expect(parseLatestVersion('# Changelog\n\n## [Unreleased]\n- wip')).toBeNull()
  })
})

describe('fetchChangelog', () => {
  beforeEach(() => {
    resetChangelogCache()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetChangelogCache()
  })

  function textResponse(body: string, ok = true, status = 200): Response {
    return { ok, status, text: async () => body } as unknown as Response
  }

  it('fetches, parses, and caches within the TTL', async () => {
    const md = '## [2.7.2] - 2026-06-07\n- fix'
    vi.mocked(fetch).mockResolvedValue(textResponse(md))

    const first = await fetchChangelog(1_000)
    expect(first).toEqual({ latestVersion: '2.7.2', markdown: md })

    const second = await fetchChangelog(1_000 + 60_000)
    expect(second).toEqual(first)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('refetches after the TTL expires', async () => {
    vi.mocked(fetch).mockResolvedValue(textResponse('## [2.7.2]\n- fix'))

    await fetchChangelog(0)
    await fetchChangelog(60 * 60 * 1000 + 1)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
  })

  it('throws when GitHub responds with an error', async () => {
    vi.mocked(fetch).mockResolvedValue(textResponse('not found', false, 404))

    await expect(fetchChangelog(0)).rejects.toThrow(/404/)
  })
})
