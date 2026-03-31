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

export const ObjectStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  TRASHED: 'trashed',
} as const

export type ObjectStatus = (typeof ObjectStatus)[keyof typeof ObjectStatus]
