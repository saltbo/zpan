import { ZPAN_CHANGELOG_RAW_URL } from '../../shared/constants'

export interface ChangelogSource {
  latestVersion: string | null
  markdown: string
}

// Pull the newest released version from the first `## [x.y.z]` heading. The
// `[Unreleased]` section carries no semver, so it is skipped automatically.
export function parseLatestVersion(markdown: string): string | null {
  const match = markdown.match(/^#{2,3}\s*\[?v?(\d+\.\d+\.\d+)\]?/m)
  return match ? match[1] : null
}

const TTL_MS = 60 * 60 * 1000 // 1 hour — releases are infrequent.
let cache: { at: number; value: ChangelogSource } | null = null

export function resetChangelogCache(): void {
  cache = null
}

export async function fetchChangelog(now: number = Date.now()): Promise<ChangelogSource> {
  if (cache && now - cache.at < TTL_MS) {
    return cache.value
  }
  const res = await fetch(ZPAN_CHANGELOG_RAW_URL, { headers: { 'user-agent': 'zpan' } })
  if (!res.ok) {
    throw new Error(`Failed to fetch changelog: ${res.status}`)
  }
  const markdown = await res.text()
  const value: ChangelogSource = { latestVersion: parseLatestVersion(markdown), markdown }
  cache = { at: now, value }
  return value
}
