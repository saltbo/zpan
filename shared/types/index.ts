import type { DirType, ObjectStatus, StorageMode, StorageStatus } from '../constants'

export interface StorageObject {
  id: string
  orgId: string
  alias: string
  name: string
  type: string
  size: number
  dirtype: DirType
  parent: string
  object: string
  storageId: string
  status: ObjectStatus
  createdAt: string
  updatedAt: string
}

export interface Storage {
  id: string
  uid: string
  title: string
  mode: StorageMode
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  customHost: string
  capacity: number
  used: number
  status: StorageStatus
  createdAt: string
  updatedAt: string
}

export interface OrgQuota {
  id: string
  orgId: string
  quota: number
  used: number
}

export interface Organization {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  createdAt: string
  updatedAt: string | null
}

export interface Member {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: string
}

export interface SystemOption {
  key: string
  value: string
  public: boolean
}

export interface AuthProvider {
  providerId: string
  type: string
  name: string
  icon: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
