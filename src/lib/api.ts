import type { OAuthProviderConfig } from '@shared/oauth-providers'
import type {
  AllowedImageMime,
  AnnouncementInput,
  ConflictStrategy,
  CreateShareRequest,
  CreateStorageInput,
  GenerateStorageCodesInput,
  StorageCodeStatus,
  UpdateStorageInput,
} from '@shared/schemas'
import type {
  ActivityEvent,
  AdminAuditEvent,
  Announcement,
  AuthProvider,
  BindingState,
  BrandingConfig,
  BrandingField,
  BrandingThemeMode,
  BrandingThemePresetId,
  BrandingThemeValues,
  IhostConfigResponse,
  ImageHosting,
  Notification,
  PaginatedResponse,
  QuotaGrant,
  QuotaStorePackage,
  QuotaStoreSettings,
  QuotaTarget,
  ShareListItem,
  ShareView,
  SiteInvitation,
  Storage,
  StorageObject,
  StorageRedemptionCode,
} from '@shared/types'
import {
  adminAnnouncementsApi,
  adminAuditApi,
  adminAuthProviders,
  adminQuotaStoreApi,
  adminQuotas,
  adminSiteInvitations,
  announcementsApi,
  authedSharesApi,
  authProviders,
  brandingAdminApi,
  emailConfig,
  ihostApi,
  ihostConfigApi,
  inviteCodes,
  licensingAdminApi,
  licensingApi,
  meApi,
  notificationsApi,
  objects,
  profiles,
  publicBrandingApi,
  publicSharesApi,
  publicSiteInvitations,
  quotaStoreApi,
  storages,
  system,
  teamsApi,
  trash,
  userQuotas,
  users,
} from './rpc'

export type { Storage, StorageObject }

export interface ApiErrorBody {
  error?: string
  code?: string
  [key: string]: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody
  constructor(status: number, body: ApiErrorBody) {
    super(body.error ?? `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface NameConflictBody extends ApiErrorBody {
  code: 'NAME_CONFLICT'
  conflictingName: string
  conflictingId: string
}

export function isNameConflictError(err: unknown): err is ApiError & { body: NameConflictBody } {
  return err instanceof ApiError && err.status === 409 && err.body.code === 'NAME_CONFLICT'
}

async function unwrap<T>(promise: Promise<Response>): Promise<T> {
  const res = await promise
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    const body: ApiErrorBody = { ...parsed, error: parsed.error ?? res.statusText }
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<T>
}

// Objects API

export function listObjects(parent: string, status = 'active', page = 1, pageSize = 500) {
  return unwrap<PaginatedResponse<StorageObject>>(
    objects.index.$get({ query: { parent, status, page: String(page), pageSize: String(pageSize) } }),
  )
}

export function listObjectsByPath(
  path: string,
  status = 'active',
  page = 1,
  pageSize = 500,
  opts?: { type?: string; search?: string },
) {
  const query: Record<string, string> = { path, status, page: String(page), pageSize: String(pageSize) }
  if (opts?.type) query.type = opts.type
  if (opts?.search) query.search = opts.search
  return unwrap<PaginatedResponse<StorageObject>>(objects.index.$get({ query }))
}

export function getObject(id: string) {
  return unwrap<StorageObject & { downloadUrl?: string }>(objects[':id'].$get({ param: { id } }))
}

export interface CreateObjectResult extends StorageObject {
  uploadUrl?: string
}

export function createObject(data: {
  name: string
  type: string
  size?: number
  parent: string
  dirtype: number
  onConflict?: ConflictStrategy
}) {
  return unwrap<CreateObjectResult>(objects.index.$post({ json: data }))
}

export function updateObject(id: string, data: { name?: string; parent?: string; onConflict?: ConflictStrategy }) {
  return unwrap<StorageObject>(objects[':id'].$patch({ param: { id }, json: { action: 'update' as const, ...data } }))
}

export function confirmUpload(id: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(
    objects[':id'].$patch({ param: { id }, json: { action: 'confirm' as const, onConflict } }),
  )
}

export function cancelUpload(id: string) {
  return unwrap<{ id: string; cancelled: boolean }>(
    objects[':id'].$patch({ param: { id }, json: { action: 'cancel' as const } }),
  )
}

export function deleteObject(id: string) {
  return unwrap<{ id: string; deleted: boolean; purged?: number }>(objects[':id'].$delete({ param: { id } }))
}

export function copyObject(id: string, parent: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(objects.copy.$post({ json: { copyFrom: id, parent, onConflict } }))
}

export function trashObject(id: string) {
  return unwrap<StorageObject>(objects[':id'].$patch({ param: { id }, json: { action: 'trash' as const } }))
}

export function restoreObject(id: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(
    objects[':id'].$patch({ param: { id }, json: { action: 'restore' as const, onConflict } }),
  )
}

export function batchMoveObjects(ids: string[], parent: string, onConflict?: ConflictStrategy) {
  return unwrap<{ moved: number }>(objects.batch.$patch({ json: { action: 'move' as const, ids, parent, onConflict } }))
}

export function batchTrashObjects(ids: string[]) {
  return unwrap<{ trashed: number }>(objects.batch.$patch({ json: { action: 'trash' as const, ids } }))
}

export function batchDeleteObjects(ids: string[]) {
  return unwrap<{ deleted: number }>(objects.batch.$delete({ json: { ids } }))
}

export function emptyTrash() {
  return unwrap<{ purged: number }>(trash.index.$delete())
}

// Admin Storages API

export function listStorages() {
  return unwrap<{ items: Storage[]; total: number }>(storages.index.$get())
}

export function createStorage(data: CreateStorageInput) {
  return unwrap<Storage>(storages.index.$post({ json: data }))
}

export function getStorage(id: string) {
  return unwrap<Storage>(storages[':id'].$get({ param: { id } }))
}

export function updateStorage(id: string, data: UpdateStorageInput) {
  return unwrap<Storage>(storages[':id'].$put({ param: { id }, json: data }))
}

export function deleteStorage(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(storages[':id'].$delete({ param: { id } }))
}

// Admin Users API

export interface UserWithOrg {
  id: string
  name: string
  username: string
  email: string
  image: string | null
  role: string | null
  banned: boolean
  createdAt: number
  orgId: string | null
  orgName: string | null
  quotaUsed: number
  quotaTotal: number
}

export function listUsers(page: number, pageSize: number, search?: string) {
  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) }
  if (search?.trim()) query.search = search.trim()
  return unwrap<{ items: UserWithOrg[]; total: number }>(users.index.$get({ query }))
}

export function updateUserStatus(userId: string, status: 'active' | 'disabled') {
  return unwrap<{ id: string; status: string }>(users[':id'].$patch({ param: { id: userId }, json: { status } }))
}

export function deleteUser(userId: string) {
  return unwrap<{ id: string; deleted: boolean }>(users[':id'].$delete({ param: { id: userId } }))
}

export function batchUpdateUserStatus(ids: string[], status: 'active' | 'disabled') {
  const action = status === 'disabled' ? 'disable' : 'enable'
  return unwrap<{ updated: number; ids: string[]; status: string }>(users.batch.$patch({ json: { action, ids } }))
}

export function batchDeleteUsers(ids: string[]) {
  return unwrap<{ deleted: number; ids: string[] }>(users.batch.$delete({ json: { ids } }))
}

export function batchUpdateUserQuota(ids: string[], quota: number) {
  return unwrap<{ updated: number; userIds: string[]; orgIds: string[]; quota: number }>(
    users.batch.$patch({ json: { action: 'set_quota' as const, ids, quota } }),
  )
}

// Admin Quotas API

export interface QuotaItem {
  orgId: string
  quota: number
  used: number
}

export function listQuotas() {
  return unwrap<{ items: QuotaItem[]; total: number }>(adminQuotas.index.$get())
}

export function updateQuota(orgId: string, quota: number) {
  return unwrap<{ orgId: string; quota: number }>(adminQuotas[':orgId'].$put({ param: { orgId }, json: { quota } }))
}

// User Quotas API

export function getUserQuota() {
  return unwrap<{ orgId: string; baseQuota: number; grantedQuota: number; quota: number; used: number }>(
    userQuotas.me.$get(),
  )
}

// Quota Store API

export function getQuotaStoreSettings() {
  return unwrap<QuotaStoreSettings | null>(adminQuotaStoreApi.settings.$get())
}

export function updateQuotaStoreSettings(data: { enabled: boolean }) {
  return unwrap<QuotaStoreSettings>(adminQuotaStoreApi.settings.$put({ json: data }))
}

export function listQuotaStorePackages() {
  return unwrap<{ items: QuotaStorePackage[]; total: number }>(adminQuotaStoreApi.packages.$get())
}

export function createQuotaStorePackage(data: {
  name: string
  description?: string
  bytes: number
  amount: number
  currency: 'usd' | 'cny'
  active?: boolean
  sortOrder?: number
}) {
  return unwrap<QuotaStorePackage>(adminQuotaStoreApi.packages.$post({ json: data }))
}

export function updateQuotaStorePackage(id: string, data: Parameters<typeof createQuotaStorePackage>[0]) {
  return unwrap<QuotaStorePackage>(adminQuotaStoreApi.packages[':id'].$put({ param: { id }, json: data }))
}

export function deleteQuotaStorePackage(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(adminQuotaStoreApi.packages[':id'].$delete({ param: { id } }))
}

export function syncQuotaStorePackages() {
  return unwrap<{ items: QuotaStorePackage[]; total: number }>(adminQuotaStoreApi.sync.$post())
}

export function listStorageRedemptionCodes(status?: StorageCodeStatus) {
  const query = status ? { status } : {}
  return unwrap<{ items: StorageRedemptionCode[]; total: number }>(adminQuotaStoreApi['storage-codes'].$get({ query }))
}

export function generateStorageRedemptionCodes(data: GenerateStorageCodesInput) {
  return unwrap<{ items: StorageRedemptionCode[]; total: number }>(
    adminQuotaStoreApi['storage-codes'].$post({ json: data }),
  )
}

export function revokeStorageRedemptionCode(code: string) {
  return unwrap<{ code: string; revoked: boolean }>(
    adminQuotaStoreApi['storage-codes'][':code'].$delete({ param: { code } }),
  )
}

export function listAdminQuotaDeliveryRecords() {
  return unwrap<{ items: QuotaGrant[]; total: number }>(adminQuotaStoreApi['delivery-records'].$get())
}

export function listPurchasableQuotaPackages() {
  return unwrap<{ items: QuotaStorePackage[]; total: number }>(quotaStoreApi.packages.$get())
}

export function listQuotaStoreTargets() {
  return unwrap<{ items: QuotaTarget[]; total: number }>(quotaStoreApi.targets.$get())
}

export function createQuotaCheckout(packageId: string, targetOrgId: string) {
  return unwrap<{ checkoutUrl: string }>(quotaStoreApi.checkout.$post({ json: { packageId, targetOrgId } }))
}

export function redeemQuotaCode(code: string, targetOrgId: string) {
  return unwrap<Record<string, unknown>>(quotaStoreApi.redemptions.$post({ json: { code, targetOrgId } }))
}

export function listQuotaGrants() {
  return unwrap<{ items: QuotaGrant[]; total: number }>(quotaStoreApi.grants.$get())
}

// System Options API

export interface SiteOption {
  key: string
  value: string
  public: boolean
}

export function listSystemOptions() {
  return unwrap<{ items: SiteOption[]; total: number }>(system.options.$get())
}

export function getSystemOption(key: string) {
  return unwrap<SiteOption>(system.options[':key'].$get({ param: { key } }))
}

export function setSystemOption(key: string, value: string, isPublic?: boolean) {
  const body: { value: string; public?: boolean } = { value }
  if (isPublic !== undefined) body.public = isPublic
  return unwrap<SiteOption>(system.options[':key'].$put({ param: { key }, json: body }))
}

// Auth Providers API

export type { AuthProvider }

export function listAuthProviders() {
  return unwrap<{ items: AuthProvider[] }>(authProviders.index.$get())
}

export function listAdminAuthProviders() {
  return unwrap<{ items: OAuthProviderConfig[] }>(adminAuthProviders.index.$get())
}

export function upsertAuthProvider(providerId: string, data: Omit<OAuthProviderConfig, 'providerId'>) {
  return unwrap<OAuthProviderConfig>(adminAuthProviders[':providerId'].$put({ param: { providerId }, json: data }))
}

export function deleteAuthProvider(providerId: string) {
  return unwrap<{ providerId: string; deleted: boolean }>(
    adminAuthProviders[':providerId'].$delete({ param: { providerId } }),
  )
}

// Invite Codes API

export interface InviteCode {
  id: string
  code: string
  createdBy: string
  usedBy: string | null
  usedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export function listInviteCodes(page = 1, pageSize = 20) {
  return unwrap<{ items: InviteCode[]; total: number }>(inviteCodes.index.$get({ query: { page, pageSize } }))
}

export function generateInviteCodes(count: number, expiresInDays?: number) {
  const body: { count: number; expiresInDays?: number } = { count }
  if (expiresInDays !== undefined) body.expiresInDays = expiresInDays
  return unwrap<{ codes: InviteCode[] }>(inviteCodes.index.$post({ json: body }))
}

export function deleteInviteCode(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(inviteCodes[':id'].$delete({ param: { id } }))
}

// Site Invitations API

export function listSiteInvitations(page = 1, pageSize = 20) {
  return unwrap<{ items: SiteInvitation[]; total: number }>(
    adminSiteInvitations.index.$get({ query: { page, pageSize } }),
  )
}

export function createSiteInvitation(email: string) {
  return unwrap<SiteInvitation>(adminSiteInvitations.index.$post({ json: { email } }))
}

export function resendSiteInvitation(id: string) {
  return unwrap<SiteInvitation>(adminSiteInvitations[':id'].resend.$post({ param: { id } }))
}

export function revokeSiteInvitation(id: string) {
  return unwrap<{ id: string; revoked: boolean }>(adminSiteInvitations[':id'].$delete({ param: { id } }))
}

export function getSiteInvitation(token: string) {
  return unwrap<SiteInvitation>(publicSiteInvitations[':token'].$get({ param: { token } }))
}

// Email Config API

export interface SmtpEmailConfig {
  enabled: boolean
  provider: 'smtp'
  from: string
  smtp: { host: string; port: number; user: string; pass: string; secure: boolean }
}

export interface HttpEmailConfig {
  enabled: boolean
  provider: 'http'
  from: string
  http: { url: string; apiKey: string }
}

export interface CloudflareEmailConfig {
  enabled: boolean
  provider: 'cloudflare'
  from: string
}

export type EmailConfigData = SmtpEmailConfig | HttpEmailConfig | CloudflareEmailConfig

export interface EmptyEmailConfigData {
  enabled: boolean
  provider: null
}

export function getEmailConfig() {
  return unwrap<EmailConfigData | EmptyEmailConfigData>(emailConfig.index.$get())
}

export function saveEmailConfig(data: EmailConfigData) {
  return unwrap<{ success: boolean }>(emailConfig.index.$put({ json: data }))
}

export function testEmail(to: string) {
  return unwrap<{ success: boolean; error?: string }>(emailConfig['test-messages'].$post({ json: { to } }))
}

// Profile API (public, no auth)

export interface PublicUser {
  username: string
  name: string
  image: string | null
}

export interface PublicMatter extends StorageObject {
  downloadUrl?: string
}

export function getProfile(username: string) {
  return unwrap<{ user: PublicUser; shares: PublicMatter[] }>(profiles[':username'].$get({ param: { username } }))
}

// Teams Activity API

export function listTeamActivities(teamId: string, page = 1, pageSize = 20) {
  return unwrap<PaginatedResponse<ActivityEvent>>(
    teamsApi[':teamId'].activity.$get({ param: { teamId }, query: { page: String(page), pageSize: String(pageSize) } }),
  )
}

// Notifications API

export type NotificationListResult = {
  items: Notification[]
  total: number
  unreadCount: number
  page: number
  pageSize: number
}

export function listNotifications(page = 1, pageSize = 20, unreadOnly = false) {
  return unwrap<NotificationListResult>(
    notificationsApi.index.$get({
      query: { page: String(page), pageSize: String(pageSize), unread: String(unreadOnly) },
    }),
  )
}

export function getUnreadCount() {
  return unwrap<{ count: number }>(notificationsApi.stats.$get())
}

export function markNotificationRead(id: string) {
  return notificationsApi[':id'].$patch({ param: { id } }).then((res) => {
    if (!res.ok) throw new ApiError(res.status, { error: res.statusText })
  })
}

export function markAllNotificationsRead() {
  return unwrap<{ count: number }>(notificationsApi.index.$patch())
}

// Announcements API

export type { Announcement, AnnouncementInput }

export type AnnouncementListResult = {
  items: Announcement[]
  total: number
  page: number
  pageSize: number
}

export function listAnnouncements(page = 1, pageSize = 20) {
  return unwrap<AnnouncementListResult>(
    announcementsApi.index.$get({ query: { page: String(page), pageSize: String(pageSize) } }),
  )
}

export function listActiveAnnouncements() {
  return unwrap<AnnouncementListResult>(
    announcementsApi.index.$get({ query: { scope: 'active', page: '1', pageSize: '20' } }),
  )
}

export function listAdminAnnouncements(page = 1, pageSize = 20, status?: Announcement['status']) {
  const query: { page: string; pageSize: string; status?: Announcement['status'] } = {
    page: String(page),
    pageSize: String(pageSize),
  }
  if (status) query.status = status
  return unwrap<AnnouncementListResult>(adminAnnouncementsApi.index.$get({ query }))
}

export function createAnnouncement(data: AnnouncementInput) {
  return unwrap<Announcement>(adminAnnouncementsApi.index.$post({ json: data }))
}

export function getAnnouncement(id: string) {
  return unwrap<Announcement>(adminAnnouncementsApi[':id'].$get({ param: { id } }))
}

export function updateAnnouncement(id: string, data: AnnouncementInput) {
  return unwrap<Announcement>(adminAnnouncementsApi[':id'].$put({ param: { id }, json: data }))
}

export function deleteAnnouncement(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(adminAnnouncementsApi[':id'].$delete({ param: { id } }))
}

// Shares API

export type { ShareListItem, ShareView }

export function listShares(page = 1, pageSize = 20, status?: 'active' | 'revoked') {
  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) }
  if (status) query.status = status
  return unwrap<{ items: ShareListItem[]; total: number; page: number; pageSize: number }>(
    authedSharesApi.index.$get({ query }),
  )
}

export function getShare(token: string) {
  return unwrap<ShareView>(publicSharesApi[':token'].$get({ param: { token } }))
}

export function deleteShare(token: string) {
  return authedSharesApi[':token'].$delete({ param: { token } }).then((res) => {
    if (!res.ok) throw new ApiError(res.status, { error: res.statusText })
  })
}

export interface CreateShareResult {
  token: string
  kind: ShareView['kind']
  urls: { landing?: string; direct?: string }
  expiresAt: string | null
  downloadLimit: number | null
}

export function createShare(data: CreateShareRequest) {
  return unwrap<CreateShareResult>(authedSharesApi.index.$post({ json: data }))
}

export function verifySharePassword(token: string, password: string) {
  return unwrap<{ ok: boolean }>(publicSharesApi[':token'].sessions.$post({ param: { token }, json: { password } }))
}

export interface ShareChildItem {
  ref: string
  name: string
  type: string
  size: number
  isFolder: boolean
}

export interface ShareChildrenResponse {
  items: ShareChildItem[]
  total: number
  page: number
  pageSize: number
  breadcrumb: Array<{ name: string; path: string }>
}

export function listShareObjects(token: string, parent = '', page = 1, pageSize = 50) {
  return unwrap<ShareChildrenResponse>(
    publicSharesApi[':token'].objects.$get({
      param: { token },
      query: { parent, page: String(page), pageSize: String(pageSize) },
    }),
  )
}

export function buildShareObjectUrl(token: string, ref: string): string {
  return `/api/shares/${token}/objects/${ref}`
}

export interface SaveShareInput {
  targetOrgId: string
  targetParent: string
}

export interface SaveShareResult {
  saved: Array<{ id: string; name: string }>
  skipped: Array<{ name: string; reason: string }>
}

export function saveShareToDrive(token: string, data: SaveShareInput) {
  return unwrap<SaveShareResult>(authedSharesApi[':token'].objects.$post({ param: { token }, json: data }))
}

// Image Host Config API

export type { IhostConfigResponse }

export function getIhostConfig() {
  return unwrap<IhostConfigResponse | null>(ihostConfigApi.index.$get())
}

export function enableIhostFeature() {
  return unwrap<IhostConfigResponse>(ihostConfigApi.index.$put({ json: { enabled: true } }))
}

export function updateIhostConfig(data: { customDomain?: string | null; refererAllowlist?: string[] | null }) {
  return unwrap<IhostConfigResponse>(ihostConfigApi.index.$put({ json: { enabled: true, ...data } }))
}

export function deleteIhostConfig() {
  return ihostConfigApi.index.$delete().then((res) => {
    if (!res.ok) throw new ApiError(res.status, { error: res.statusText })
  })
}

// Image Host API Keys (via better-auth apiKey plugin)

export interface IhostApiKey {
  id: string
  name: string | null
  start: string | null
  prefix: string | null
  createdAt: string
  lastRequest: string | null
  permissions: Record<string, string[]> | null
  referenceId: string
  enabled: boolean
}

export interface CreateIhostApiKeyResult extends IhostApiKey {
  key: string
}

async function apiKeyFetch<T>(path: string, options: RequestInit): Promise<T> {
  const res = await fetch(`/api/auth${path}`, { credentials: 'include', ...options })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
  return res.json() as Promise<T>
}

export function listIhostApiKeys(organizationId: string) {
  return apiKeyFetch<{ apiKeys: IhostApiKey[] }>(`/api-key/list?organizationId=${encodeURIComponent(organizationId)}`, {
    method: 'GET',
  }).then((res) => res.apiKeys.filter((k) => k.permissions?.['image-hosting']?.includes('upload')))
}

export function createIhostApiKey(organizationId: string, name: string) {
  return apiKeyFetch<CreateIhostApiKeyResult>('/api-key/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      organizationId,
    }),
  })
}

export function revokeIhostApiKey(keyId: string) {
  return apiKeyFetch<{ success: boolean }>('/api-key/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId }),
  })
}

// Licensing API

export type { BindingState }

export interface PairingInfo {
  code: string
  pairing_url: string
  expires_at: string
}

export interface PairingPollResult {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  plan?: string
}

export function getLicensingStatus() {
  return unwrap<BindingState>(licensingApi.status.$get())
}

export function connectCloud() {
  return unwrap<PairingInfo>(licensingAdminApi.pair.$post())
}

export function pollPairing(code: string) {
  return unwrap<PairingPollResult>(licensingAdminApi.pair[':code'].poll.$get({ param: { code } }))
}

export function refreshLicense() {
  return unwrap<{ success: boolean; last_refresh_at: number | null }>(licensingAdminApi.refresh.$post())
}

export function disconnectCloud() {
  return unwrap<{ deleted: boolean }>(licensingAdminApi.binding.$delete())
}

// Auth API — Better Auth passthrough, not typed via Hono RPC
export async function getSession(): Promise<{ session: unknown; user: unknown } | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

export interface UploadProgress {
  loaded: number
  total: number
}

export interface UploadToS3Options {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

// S3 direct upload (external presigned URL, not our API)
export function uploadToS3(url: string, file: File, options: UploadToS3Options = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => {
      xhr.abort()
      reject(new DOMException('Upload cancelled', 'AbortError'))
    }

    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'))
      return
    }

    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.upload.onprogress = (event) => {
      options.onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : file.size,
      })
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.({ loaded: file.size, total: file.size })
        resolve()
        return
      }
      reject(new Error('Upload failed'))
    }
    xhr.onerror = () => {
      options.signal?.removeEventListener('abort', abort)
      reject(new Error('Upload failed'))
    }
    xhr.onabort = () => {
      options.signal?.removeEventListener('abort', abort)
    }
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.send(file)
  })
}

// Image Host Images API

export type { ImageHosting }

export interface IhostImageListResult {
  items: ImageHosting[]
  nextCursor: string | null
}

export interface IhostImageDraft {
  id: string
  token: string
  path: string
  uploadUrl: string
  storageKey: string
}

export function listIhostImages(opts?: { pathPrefix?: string; cursor?: string; limit?: number }) {
  const query: Record<string, string> = {}
  if (opts?.pathPrefix) query.pathPrefix = opts.pathPrefix
  if (opts?.cursor) query.cursor = opts.cursor
  if (opts?.limit != null) query.limit = String(opts.limit)
  return unwrap<IhostImageListResult>(ihostApi.images.$get({ query }))
}

export function createIhostImagePresign(data: { path: string; mime: AllowedImageMime; size: number }) {
  return unwrap<IhostImageDraft>(ihostApi.images.presign.$post({ json: data }))
}

export function confirmIhostImage(id: string) {
  return unwrap<ImageHosting>(ihostApi.images[':id'].$patch({ param: { id }, json: { action: 'confirm' as const } }))
}

export async function deleteIhostImage(id: string) {
  const res = await ihostApi.images[':id'].$delete({ param: { id } })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}

// Public image upload (avatar / org logo)
//
// PUT endpoints use multipart/form-data, which Hono RPC doesn't express
// cleanly — we use raw fetch for PUT and keep Hono RPC for DELETE. Returns
// the permanent public URL that was just written to user.image /
// organization.logo.

async function putImageMultipart(url: string, file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch(url, {
    method: 'PUT',
    body: form,
    credentials: 'include',
  })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
  return res.json() as Promise<{ url: string }>
}

export function uploadAvatar(file: File) {
  return putImageMultipart('/api/me/avatar', file)
}

export async function deleteAvatar() {
  const res = await meApi.avatar.$delete()
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}

export function uploadTeamLogo(teamId: string, file: File) {
  return putImageMultipart(`/api/teams/${encodeURIComponent(teamId)}/logo`, file)
}

export async function deleteTeamLogo(teamId: string) {
  const res = await teamsApi[':teamId'].logo.$delete({ param: { teamId } })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}

// Branding API

export type { BrandingConfig, BrandingField, BrandingThemeMode, BrandingThemePresetId, BrandingThemeValues }

export function getBranding() {
  return unwrap<BrandingConfig>(publicBrandingApi.index.$get())
}

// PUT uses multipart/form-data (logo/favicon are File objects).
// Hono RPC does not express multipart cleanly — same documented exception as avatar/team logo uploads.
export async function saveBranding(data: {
  logo?: File | null
  favicon?: File | null
  wordmark_text?: string
  hide_powered_by?: boolean
  theme_mode?: BrandingThemeMode
  theme_preset?: BrandingThemePresetId
  theme_custom?: BrandingThemeValues
}): Promise<BrandingConfig> {
  const form = new FormData()
  if (data.logo) form.set('logo', data.logo)
  if (data.favicon) form.set('favicon', data.favicon)
  // Empty string is submitted as an explicit clear; server treats it as setting wordmark to "".
  // Use resetBrandingField('wordmark_text') to fully remove the key.
  if (data.wordmark_text !== undefined) form.set('wordmark_text', data.wordmark_text)
  if (data.hide_powered_by !== undefined) form.set('hide_powered_by', data.hide_powered_by ? 'true' : 'false')
  if (data.theme_mode !== undefined) form.set('theme_mode', data.theme_mode)
  if (data.theme_preset !== undefined) form.set('theme_preset', data.theme_preset)
  if (data.theme_custom) {
    form.set('theme_primary_color', data.theme_custom.primary_color)
    form.set('theme_primary_foreground', data.theme_custom.primary_foreground)
    form.set('theme_canvas_color', data.theme_custom.canvas_color)
    form.set('theme_sidebar_accent_color', data.theme_custom.sidebar_accent_color)
    form.set('theme_ring_color', data.theme_custom.ring_color)
  }

  const res = await fetch('/api/admin/branding', {
    method: 'PUT',
    body: form,
    credentials: 'include',
  })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
  return res.json() as Promise<BrandingConfig>
}

export async function resetBrandingField(field: BrandingField): Promise<void> {
  const res = await brandingAdminApi[':field'].$delete({ param: { field } })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}

// Admin Audit Logs API

export interface AdminAuditFilter {
  orgId?: string
  userId?: string
  action?: string
  targetType?: string
}

export function listAdminAuditLogs(page = 1, pageSize = 20, filter: AdminAuditFilter = {}) {
  const query: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
  }
  if (filter.orgId) query.orgId = filter.orgId
  if (filter.userId) query.userId = filter.userId
  if (filter.action) query.action = filter.action
  if (filter.targetType) query.targetType = filter.targetType
  return unwrap<PaginatedResponse<AdminAuditEvent>>(adminAuditApi.index.$get({ query }))
}
