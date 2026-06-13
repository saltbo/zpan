export interface ChangelogSource {
  // Newest published release version (without the leading "v"), or null when the
  // GitHub API is unreachable/rate-limited.
  latestVersion: string | null
  // Raw, product-facing CHANGELOG.md markdown for the drawer.
  markdown: string
}

export interface ChangelogProvider {
  fetchChangelog(now?: number, opts?: { force?: boolean }): Promise<ChangelogSource>
}
