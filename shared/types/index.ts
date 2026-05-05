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

export type QuotaGrantSource = 'stripe' | 'redeem_code' | 'admin_adjustment'
export type QuotaPackageSyncStatus = 'pending' | 'synced' | 'failed'
export type QuotaDeliveryEventStatus = 'processed' | 'duplicate' | 'failed'

export interface QuotaStoreSettings {
  id: string
  enabled: boolean
  cloudBaseUrl: string
  publicInstanceUrl: string
  webhookSigningSecretSet: boolean
  createdAt: string
  updatedAt: string
}

export interface QuotaStorePackage {
  id: string
  name: string
  description: string
  bytes: number
  amount: number
  currency: string
  active: boolean
  sortOrder: number
  cloudPackageId: string | null
  syncStatus: QuotaPackageSyncStatus
  syncError: string | null
  createdAt: string
  updatedAt: string
}

export interface QuotaGrant {
  id: string
  orgId: string
  source: QuotaGrantSource
  externalEventId: string | null
  cloudOrderId: string | null
  cloudRedemptionId: string | null
  code: string | null
  bytes: number
  packageSnapshot: string | null
  grantedBy: string | null
  terminalUserId: string | null
  terminalUserEmail: string | null
  active: boolean
  createdAt: string
}

export interface QuotaTarget {
  orgId: string
  name: string
  type: string
  role: string
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

export type SiteInvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface SiteInvitation {
  id: string
  email: string
  token: string
  invitedBy: string
  invitedByName: string
  acceptedBy: string | null
  acceptedAt: string | null
  revokedBy: string | null
  revokedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
  status: SiteInvitationStatus
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

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export interface Announcement {
  id: string
  title: string
  body: string
  status: AnnouncementStatus
  priority: number
  publishedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
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

export interface AdminAuditEvent extends ActivityEvent {
  orgName: string | null
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

export type { BindingState, LicenseAssertion, ProFeature } from './licensing'

export type BrandingThemePresetId = 'default' | 'ocean' | 'forest' | 'rose'

export type BrandingThemeMode = 'preset' | 'custom'

export interface BrandingThemeValues {
  primary_color: string
  primary_foreground: string
  canvas_color: string
  sidebar_accent_color: string
  ring_color: string
}

export interface BrandingThemeConfig {
  mode: BrandingThemeMode
  preset: BrandingThemePresetId
  custom: BrandingThemeValues | null
  configured: boolean
}

export const BRANDING_THEME_PRESETS: Record<BrandingThemePresetId, BrandingThemeValues> = {
  default: {
    primary_color: '#1a73e8',
    primary_foreground: '#ffffff',
    canvas_color: '#f8fafc',
    sidebar_accent_color: '#dbeafe',
    ring_color: '#1a73e8',
  },
  ocean: {
    primary_color: '#007c89',
    primary_foreground: '#ffffff',
    canvas_color: '#effafa',
    sidebar_accent_color: '#cffafe',
    ring_color: '#0891b2',
  },
  forest: {
    primary_color: '#2f6f4e',
    primary_foreground: '#ffffff',
    canvas_color: '#f3f8f2',
    sidebar_accent_color: '#dcfce7',
    ring_color: '#3f8f63',
  },
  rose: {
    primary_color: '#be3455',
    primary_foreground: '#ffffff',
    canvas_color: '#fff5f7',
    sidebar_accent_color: '#ffe4e6',
    ring_color: '#e11d48',
  },
}

export function isBrandingThemePresetId(value: string): value is BrandingThemePresetId {
  return Object.hasOwn(BRANDING_THEME_PRESETS, value)
}

export interface BrandingConfig {
  logo_url: string | null
  favicon_url: string | null
  wordmark_text: string | null
  hide_powered_by: boolean
  theme: BrandingThemeConfig
}

export type BrandingThemeField =
  | 'theme'
  | 'theme_mode'
  | 'theme_preset'
  | 'theme_primary_color'
  | 'theme_primary_foreground'
  | 'theme_canvas_color'
  | 'theme_sidebar_accent_color'
  | 'theme_ring_color'

export type BrandingField = 'logo' | 'favicon' | 'wordmark_text' | 'hide_powered_by' | BrandingThemeField
