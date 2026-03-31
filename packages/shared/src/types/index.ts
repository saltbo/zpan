import type { StorageMode, DirType, ObjectStatus } from '../constants'

export interface StorageObject {
  id: string
  uid: string
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
  title: string
  mode: StorageMode
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  filePath: string
  customHost: string
  capacityBytes: number | null
  usedBytes: number
  priority: number
  status: number
  createdAt: string
  updatedAt: string
}

export interface StorageQuota {
  id: string
  uid: string
  quota: number
  used: number
}

export interface SystemOption {
  key: string
  value: string
  public: boolean
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
