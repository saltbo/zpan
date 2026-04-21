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

export interface Invitation {
  id: string
  organizationId: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: string
  inviterId: string
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

import type { ShareKind as _ShareKind } from '../schemas/share'

export type { ShareKind } from '../schemas/share'

// passwordHash is intentionally not part of the shared wire type; it never leaves the server.
export interface Share {
  id: string
  token: string
  kind: _ShareKind
  matterId: string
  orgId: string
  creatorId: string
  expiresAt: string | null
  downloadLimit: number | null
  views: number
  downloads: number
  status: 'active' | 'revoked'
  createdAt: string
}

export interface ShareRecipient {
  id: string
  shareId: string
  recipientUserId: string | null
  recipientEmail: string | null
  createdAt: string
}

export interface ShareMatter {
  name: string
  type: string
  dirtype: number
}

export interface ShareListItem extends Share {
  matter: ShareMatter
  recipientCount: number
}

export interface ShareView {
  token: string
  kind: _ShareKind
  status: 'active' | 'revoked'
  expiresAt: string | null
  downloadLimit: number | null
  matter: { name: string; type: string; size: number; isFolder: boolean }
  creatorName: string
  requiresPassword: boolean
  expired: boolean
  exhausted: boolean
  accessibleByUser: boolean
  downloads: number
  views: number
  rootRef: string

  id?: string
  matterId?: string
  orgId?: string
  creatorId?: string
  createdAt?: string
  recipients?: ShareRecipient[]
}

export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  body: string
  refType: string | null
  refId: string | null
  metadata: string | null
  readAt: string | null
  createdAt: string
}

export interface ActivityEvent {
  id: string
  orgId: string
  userId: string
  action: string
  targetType: string
  targetId: string | null
  targetName: string
  metadata: string | null
  createdAt: string
  user: {
    id: string
    name: string
    image: string | null
  }
}

export interface ImageHostingConfig {
  orgId: string
  customDomain: string | null
  cfHostnameId: string | null
  domainVerifiedAt: string | null
  refererAllowlist: string | null // JSON array of strings; null/empty => allow all
  createdAt: string
  updatedAt: string
}

export interface IhostConfigResponse {
  enabled: boolean
  customDomain: string | null
  domainVerifiedAt: number | null
  domainStatus: 'none' | 'pending' | 'verified'
  dnsInstructions: { recordType: string; name: string; target: string } | null
  refererAllowlist: string[] | null
  createdAt: number
}

export type ImageHostingStatus = 'draft' | 'active'

export interface IhostImageDraftResponse {
  id: string
  token: string
  path: string
  uploadUrl: string
  storageKey: string
}

export interface IhostImageToolResponse {
  data: {
    url: string
    urlAlt: string
    markdown: string
    html: string
    bbcode: string
  }
}

export interface ImageHosting {
  id: string
  orgId: string
  token: string
  path: string
  storageId: string
  storageKey: string
  size: number
  mime: string
  width: number | null
  height: number | null
  status: ImageHostingStatus
  accessCount: number
  lastAccessedAt: string | null
  createdAt: string
}
