import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchChangelog, resetChangelogCache } from './changelog.js'

const CHANGELOG_MD = '## [2.7.2] - 2026-06-07\n- product-facing notes'

function releaseResponse(tagName: string | undefined, ok = true, status = 200): Response {
  return { ok, status, json: async () => ({ tag_name: tagName }) } as unknown as Response
}

function markdownResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response
}

// Route the two outbound calls (release API vs raw changelog) to separate stubs.
function stubFetch(opts: { release: () => Response; changelog: () => Response }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new URL(String(url)).hostname === 'api.github.com' ? opts.release() : opts.changelog(),
    ),
  )
}

describe('fetchChangelog', () => {
  beforeEach(() => {
    resetChangelogCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetChangelogCache()
  })

  it('takes the version from the release tag and the markdown from CHANGELOG.md', async () => {
    stubFetch({ release: () => releaseResponse('v2.8.0'), changelog: () => markdownResponse(CHANGELOG_MD) })

    const result = await fetchChangelog(1_000)

    expect(result).toEqual({ latestVersion: '2.8.0', markdown: CHANGELOG_MD })
  })

  it('caches both sources within the TTL', async () => {
    stubFetch({ release: () => releaseResponse('v2.8.0'), changelog: () => markdownResponse(CHANGELOG_MD) })

    await fetchChangelog(1_000)
    await fetchChangelog(1_000 + 60_000)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2) // one release + one changelog, then cached
  })

  it('refetches after the TTL expires', async () => {
    stubFetch({ release: () => releaseResponse('v2.8.0'), changelog: () => markdownResponse(CHANGELOG_MD) })

    await fetchChangelog(0)
    await fetchChangelog(60 * 60 * 1000 + 1)

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4)
  })

  it('degrades latestVersion to null when the release API fails, keeping the markdown', async () => {
    stubFetch({
      release: () => releaseResponse(undefined, false, 403),
      changelog: () => markdownResponse(CHANGELOG_MD),
    })

    const result = await fetchChangelog(0)

    expect(result).toEqual({ latestVersion: null, markdown: CHANGELOG_MD })
  })

  it('throws when the CHANGELOG.md fetch fails', async () => {
    stubFetch({ release: () => releaseResponse('v2.8.0'), changelog: () => markdownResponse('not found', false, 404) })

    await expect(fetchChangelog(0)).rejects.toThrow(/404/)
  })
})
