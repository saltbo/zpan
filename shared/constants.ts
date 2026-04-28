export const StorageMode = {
  PRIVATE: 'private',
  PUBLIC: 'public',
} as const

export type StorageMode = (typeof StorageMode)[keyof typeof StorageMode]

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

export const ObjectStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  TRASHED: 'trashed',
} as const

export type ObjectStatus = (typeof ObjectStatus)[keyof typeof ObjectStatus]

export const SignupMode = {
  OPEN: 'open',
  INVITE_ONLY: 'invite_only',
  CLOSED: 'closed',
} as const

export type SignupMode = (typeof SignupMode)[keyof typeof SignupMode]

export const ZPAN_CLOUD_URL_DEFAULT = 'https://cloud.zpan.space'
export const DEFAULT_SITE_NAME = 'ZPan'
export const DEFAULT_SITE_DESCRIPTION = ''

// Free plan allows up to this many organizations per user (including personal workspace).
// The 3rd organization requires the teams_unlimited feature.
export const FREE_TEAM_LIMIT = 2

// Free plan allows up to this many extra team workspaces beyond the personal workspace.
export const FREE_EXTRA_TEAM_LIMIT = 1

// Free plan allows up to this many storage backends per instance.
// The 4th storage requires the storages_unlimited feature.
export const FREE_STORAGE_LIMIT = 3
