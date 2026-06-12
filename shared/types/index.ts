import type { CommercePayment, CommerceProduct, ProductPrice } from 'zpan-cloud-sdk'
import type { DirType, ObjectStatus, StorageMode, StorageStatus } from '../constants'
import type {
  CloudOrder as ZPanCloudOrder,
  CloudOrderFulfillmentPayload as ZPanCloudOrderFulfillmentPayload,
  CloudOrderItem as ZPanCloudOrderItem,
} from '../schemas/cloud-store'

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
  egressCreditBillingEnabled: boolean
  egressCreditUnitBytes: number
  egressCreditPerUnit: number
  used: number
  status: StorageStatus
  createdAt: string
  updatedAt: string
}

export interface OrgQuota {
  id: string
  orgId: string
  baseQuota: number
  entitlementQuota: number
  quota: number
  used: number
  baseTrafficQuota: number
  entitlementTrafficQuota: number
  trafficQuota: number
  trafficUsed: number
  trafficPeriod: string
  storagePlanName: string | null
  storageExtraNames: string[]
  trafficPlanName: string | null
  trafficExtraNames: string[]
  currentPlan?: CurrentStoragePlan | null
}

export interface OrgQuotaEntitlement {
  id: string
  orgId: string
  resourceType: 'storage' | 'traffic' | string
  entitlementType: 'plan' | 'campaign' | 'grant' | string
  source: string
  sourceId: string
  bytes: number
  startsAt: string
  expiresAt: string | null
  status: string
  metadata: string | null
  createdAt: string
  updatedAt: string
}

export interface CurrentStoragePlan {
  sourceId: string
  packageId: string | null
  name: string
  storageBytes: number
  trafficBytes: number
  trafficOveragePriceCents: number | null
  expiresAt: string | null
  subscription: boolean
}

export type WebhookEventStatus = 'processed' | 'duplicate' | 'failed'

export type CloudProduct = CommerceProduct
export type CloudProductPrice = ProductPrice
export type CloudOrderFulfillmentPayload = ZPanCloudOrderFulfillmentPayload
export type CloudOrderItem = ZPanCloudOrderItem

export interface CloudOrderTarget {
  orgId?: string
  customerId?: string
  customerLabel?: string
}

export type CloudOrderPayment = CommercePayment
export type CloudOrder = ZPanCloudOrder
export interface CloudGiftCard {
  id: string
  storeId: string
  campaignId: string | null
  code: string | null
  codeLast4: string
  credits: number
  status: 'active' | 'redeemed' | 'disabled' | 'expired' | 'revoked'
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  disabledAt: string | null
  revokedAt: string | null
  createdByAdmin: string
}

export interface CloudStoreTarget {
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

export type DownloaderStatus = 'online' | 'offline' | 'disabled'
export type DownloaderEngine = 'builtin' | 'aria2' | 'qbittorrent'

export interface Downloader {
  id: string
  name: string
  status: DownloaderStatus
  enabled: boolean
  version: string
  hostname: string
  platform: string
  arch: string
  engine: DownloaderEngine
  capabilities: string[]
  maxConcurrentTasks: number
  currentTasks: number
  downloadBps: number
  uploadBps: number
  freeDiskBytes: number
  remoteDownloadCreditBillingEnabled: boolean
  remoteDownloadCreditUnitBytes: number
  remoteDownloadCreditPerUnit: number
  lastHeartbeatAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type DownloadSourceType = 'http' | 'magnet' | 'torrent_url'
export type DownloadTaskStatus =
  | 'queued'
  | 'assigned'
  | 'downloading'
  | 'suspended'
  | 'pausing'
  | 'paused'
  | 'interrupted'
  | 'uploading'
  | 'canceling'
  | 'completed'
  | 'failed'
  | 'canceled'

export type DownloadTaskAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'restart' | 'delete'
export type DownloadTaskRuntimePhase = 'metadata' | 'downloading' | 'uploading' | 'seeding' | 'completed' | 'error'
export type DownloadTaskBillingState = 'none' | 'ok' | 'insufficient_credits'

export interface DownloadTask {
  id: string
  orgId?: string
  createdBy?: string
  spec: DownloadTaskSpec
  status: DownloadTaskExecutionStatus
  createdAt: string
}

export interface DownloadTaskSpec {
  source: {
    type: DownloadSourceType
    uri: string
  }
  destination: {
    folder: string
    name: string | null
  }
  labels: {
    category: string | null
    tags: string[]
  }
}

export interface DownloadTaskExecutionStatus {
  state: DownloadTaskStatus
  attempt: number
  assignment: DownloadTaskAssignment | null
  progress: DownloadTaskProgress
  billing: DownloadTaskBilling
  output: DownloadTaskOutput | null
  runtime: DownloadTaskRuntime | null
  error: DownloadTaskError | null
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface DownloadTaskAssignment {
  downloaderId: string
  assignedAt?: string | null
  uploadToken?: string
}

export interface DownloadTaskTransferProgress {
  bytes: number
  totalBytes?: number | null
  bytesPerSecond: number
}

export interface DownloadTaskProgress {
  download: DownloadTaskTransferProgress
  upload: DownloadTaskTransferProgress
}

export interface DownloadTaskBilling {
  state: DownloadTaskBillingState
  authorizedBytes: number
  chargedBytes: number
  chargedCredits: number
}

export interface DownloadTaskOutput {
  objectId: string
}

export interface DownloadTaskError {
  code?: string | null
  message: string | null
}

export interface DownloadTaskTracker {
  url: string
  status?: string
  peers?: number
  seeds?: number
  leechers?: number
  message?: string
}

export interface DownloadTaskPeer {
  address: string
  client?: string
  progress?: number
  downloadBps?: number
  uploadBps?: number
  countryCode?: string
  regionCode?: string
}

export interface DownloadTaskFile {
  path: string
  size: number
  completedBytes?: number
  selected?: boolean
}

export interface DownloadTaskRuntime {
  engine?: Downloader['engine']
  state?: string
  phase?: DownloadTaskRuntimePhase
  message?: string
  updatedAt?: string
  progress?: DownloadTaskProgress
  torrent?: DownloadTaskTorrentRuntime
  seeding?: DownloadTaskSeedingRuntime
  connections?: number
  etaSeconds?: number | null
  trackers?: DownloadTaskTracker[]
  peers?: DownloadTaskPeer[]
  files?: DownloadTaskFile[]
}

export interface DownloadTaskTorrentRuntime {
  infoHash?: string
  name?: string
  seeders?: number
  leechers?: number
  peers?: number
}

export interface DownloadTaskSeedingRuntime {
  enabled?: boolean
  active?: boolean
  uploadedBytes?: number
  uploadBytesPerSecond?: number
  ratio?: number
  startedAt?: string | null
  expiresAt?: string | null
}

export interface ObjectUploadSession {
  id: string
  objectId: string
  uploadId: string
  partSize: number
  status: 'active' | 'completed' | 'aborted'
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export type KnownBackgroundJobType = 'archive_compress' | 'archive_extract'
export type BackgroundJobType = KnownBackgroundJobType | (string & {})

export interface BackgroundJobProgress {
  inputBytes: number
  outputBytes: number
  processedBytes: number
  fileCount: number
  currentFilename: string | null
}

export interface BackgroundJob {
  id: string
  orgId: string
  userId: string
  type: BackgroundJobType
  status: BackgroundJobStatus
  targetFolder: string | null
  targetPath: string | null
  metadata: Record<string, unknown> | null
  progress: BackgroundJobProgress
  errorMessage: string | null
  resultMetadata: Record<string, unknown> | null
  retryable: boolean
  cancelable: boolean
  retriedFromJobId: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
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
  // Present on received shares: display name of the user who shared it.
  creatorName?: string
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

export type NotificationType = 'share_received' | 'archive_job_completed' | 'archive_job_failed' | 'team_join'

export interface Notification {
  id: string
  userId: string
  type: NotificationType
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

export type { ChangelogInfo, InstanceInfo } from './instance'
export type { BindingState, LicenseAssertion, LicenseEdition, LicenseFeature, ProFeature } from './licensing'

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
