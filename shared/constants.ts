export const UserRole = {
  ADMIN: 'admin',
  MEMBER: 'member',
} as const

export type UserRole = (typeof UserRole)[keyof typeof UserRole]

export const DirType = {
  FILE: 0,
  USER_FOLDER: 1,
  SYSTEM_FOLDER: 2,
} as const

export type DirType = (typeof DirType)[keyof typeof DirType]

export const StorageStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const

export type StorageStatus = (typeof StorageStatus)[keyof typeof StorageStatus]

// Soft delete is tracked by the `trashedAt` timestamp, not a status value:
// live = active & trashedAt IS NULL, trash = active & trashedAt IS NOT NULL.
export const ObjectStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
} as const

export type ObjectStatus = (typeof ObjectStatus)[keyof typeof ObjectStatus]

export const SignupMode = {
  OPEN: 'open',
  INVITE_ONLY: 'invite_only',
  CLOSED: 'closed',
} as const

export type SignupMode = (typeof SignupMode)[keyof typeof SignupMode]

export const ZPAN_CLOUD_URL_DEFAULT = 'https://cloud.zpan.space'
export const ZPAN_GITHUB_URL = 'https://github.com/saltbo/zpan'
export const WEBDAV_URL_OPTION_KEY = 'webdav_url'
// The About page renders this hand-maintained, product-facing changelog in a
// side drawer; raw.githubusercontent.com serves the file with CORS.
export const ZPAN_CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/saltbo/zpan/main/CHANGELOG.md'
// The latest-version indicator comes from the newest published GitHub Release
// (tag_name), not the changelog file — releases are the source of truth for
// "what's the latest shipped version".
export const ZPAN_RELEASES_LATEST_API_URL = 'https://api.github.com/repos/saltbo/zpan/releases/latest'
// Build a link to a specific commit on GitHub.
export const githubCommitUrl = (sha: string) => `${ZPAN_GITHUB_URL}/commit/${sha}`
export const DEFAULT_SITE_NAME = 'ZPan'
export const DEFAULT_SITE_DESCRIPTION = ''
export const DEFAULT_ORG_QUOTA = 10 * 1024 * 1024
export const DEFAULT_ORG_TRAFFIC_QUOTA = 0

// Free plan allows up to this many organizations per user (including personal workspace).
// The 3rd organization requires the teams_unlimited feature.
export const FREE_TEAM_LIMIT = 2

// Free plan allows up to this many extra team workspaces beyond the personal workspace.
export const FREE_EXTRA_TEAM_LIMIT = 1

// Free plan allows up to this many storage backends per instance.
// The 4th storage requires the storages_unlimited feature.
export const FREE_STORAGE_LIMIT = 3

// Free plan allows up to this many social login / OIDC providers per instance.
// The 2nd provider requires the social_login_unlimited feature.
export const FREE_SOCIAL_LOGIN_LIMIT = 1

// Free plan allows up to this many downloaders per instance.
// The 2nd downloader requires the downloaders_unlimited feature.
export const FREE_DOWNLOADER_LIMIT = 1
