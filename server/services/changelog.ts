import { ZPAN_CHANGELOG_RAW_URL, ZPAN_RELEASES_LATEST_API_URL } from '../../shared/constants'

export interface ChangelogSource {
  // Newest published release version (without the leading "v"), or null when the
  // GitHub API is unreachable/rate-limited.
  latestVersion: string | null
  // Raw, product-facing CHANGELOG.md markdown for the drawer.
  markdown: string
}

async function fetchLatestReleaseVersion(): Promise<string | null> {
  // Best-effort: the unauthenticated GitHub API is rate-limited (60/hr/IP), so a
  // failure here must not break the drawer — it only hides the version badge.
  try {
    const res = await fetch(ZPAN_RELEASES_LATEST_API_URL, {
      headers: { 'user-agent': 'zpan', accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string }
    const tag = data.tag_name?.trim()
    return tag ? tag.replace(/^v/, '') : null
  } catch {
    return null
  }
}

async function fetchChangelogMarkdown(): Promise<string> {
  const res = await fetch(ZPAN_CHANGELOG_RAW_URL, { headers: { 'user-agent': 'zpan' } })
  if (!res.ok) {
    throw new Error(`Failed to fetch changelog: ${res.status}`)
  }
  return res.text()
}

const TTL_MS = 60 * 60 * 1000 // 1 hour — releases are infrequent.
let cache: { at: number; value: ChangelogSource } | null = null

export function resetChangelogCache(): void {
  cache = null
}

export async function fetchChangelog(
  now: number = Date.now(),
  opts: { force?: boolean } = {},
): Promise<ChangelogSource> {
  if (!opts.force && cache && now - cache.at < TTL_MS) {
    return cache.value
  }
  const [latestVersion, markdown] = await Promise.all([fetchLatestReleaseVersion(), fetchChangelogMarkdown()])
  const value: ChangelogSource = { latestVersion, markdown }
  cache = { at: now, value }
  return value
}
