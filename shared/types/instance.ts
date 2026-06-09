// Instance metadata reported to ZPan Cloud and shown on the admin About page.
export interface InstanceInfo {
  id: string
  name: string
  url: string
  version: string
  commit?: string | null
  runtime?: {
    provider: 'cloudflare' | 'node'
    target: 'cloudflare-worker' | 'node/docker'
  } | null
  server?: {
    os?: {
      platform?: string | null
      arch?: string | null
      release?: string | null
    } | null
  } | null
  node?: {
    version?: string | null
  } | null
}

// Changelog feed shown on the About page, sourced from CHANGELOG.md on GitHub.
export interface ChangelogInfo {
  // The version this instance is running, from the build-time version global.
  currentVersion: string
  // Newest released version parsed from the changelog, or null if undetectable.
  latestVersion: string | null
  // True when latestVersion is strictly newer than currentVersion.
  updateAvailable: boolean
  // Raw CHANGELOG.md markdown for rendering in the drawer.
  markdown: string
}
