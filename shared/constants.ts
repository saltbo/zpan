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

export const ProFeatures = {
  WHITE_LABEL: 'white_label',
  OPEN_REGISTRATION: 'open_registration',
  TEAMS_UNLIMITED: 'teams_unlimited',
  TEAM_QUOTAS: 'team_quotas',
} as const

export type ProFeatures = (typeof ProFeatures)[keyof typeof ProFeatures]

export const ZPAN_CLOUD_URL_DEFAULT = 'https://cloud.zpan.space'
