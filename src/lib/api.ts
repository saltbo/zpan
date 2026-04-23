import type { OAuthProviderConfig } from '@shared/oauth-providers'
import type {
  AllowedImageMime,
  AvatarMime,
  ConflictStrategy,
  CreateShareRequest,
  CreateStorageInput,
  OrgLogoMime,
  UpdateStorageInput,
} from '@shared/schemas'
import type {
  ActivityEvent,
  AuthProvider,
  IhostConfigResponse,
  ImageHosting,
  Notification,
  PaginatedResponse,
  ShareListItem,
  ShareView,
  Storage,
  StorageObject,
} from '@shared/types'
import {
  adminAuthProviders,
  adminQuotas,
  authedSharesApi,
  authProviders,
  emailConfig,
  ihostApi,
  ihostConfigApi,
  inviteCodes,
  notificationsApi,
  objects,
  profileMeApi,
  profiles,
  publicSharesApi,
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
  role: string | null
  banned: boolean
  createdAt: number
  orgId: string | null
  orgName: string | null
}

export function listUsers(page: number, pageSize: number) {
  return unwrap<{ items: UserWithOrg[]; total: number }>(
    users.index.$get({ query: { page: String(page), pageSize: String(pageSize) } }),
  )
}

export function updateUserStatus(userId: string, status: 'active' | 'disabled') {
  return unwrap<{ id: string; status: string }>(users[':id'].$patch({ param: { id: userId }, json: { status } }))
}

export function deleteUser(userId: string) {
  return unwrap<{ id: string; deleted: boolean }>(users[':id'].$delete({ param: { id: userId } }))
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
  return unwrap<{ orgId: string; quota: number; used: number }>(userQuotas.me.$get())
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

// Email Config API

export interface SmtpEmailConfig {
  provider: 'smtp'
  from: string
  smtp: { host: string; port: number; user: string; pass: string; secure: boolean }
}

export interface HttpEmailConfig {
  provider: 'http'
  from: string
  http: { url: string; apiKey: string }
}

export type EmailConfigData = SmtpEmailConfig | HttpEmailConfig

export function getEmailConfig() {
  return unwrap<EmailConfigData | { provider: null }>(emailConfig.index.$get())
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

// Auth API — Better Auth passthrough, not typed via Hono RPC
export async function getSession(): Promise<{ session: unknown; user: unknown } | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

// S3 direct upload (external presigned URL, not our API)
export function uploadToS3(url: string, file: File): Promise<void> {
  return fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  }).then((res) => {
    if (!res.ok) throw new Error('Upload failed')
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

// Avatar Upload API

export interface AvatarUploadDraft {
  uploadUrl: string
  key: string
}

export function requestAvatarUpload(data: { mime: AvatarMime; size: number }) {
  return unwrap<AvatarUploadDraft>(profileMeApi.avatar.$post({ json: data }))
}

export function commitAvatar(data: { mime: AvatarMime }) {
  return unwrap<{ image: string }>(profileMeApi.avatar.commit.$post({ json: data }))
}

export async function deleteAvatar() {
  const res = await profileMeApi.avatar.$delete()
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}

// Org Logo Upload API

export interface OrgLogoUploadDraft {
  uploadUrl: string
  key: string
}

export function requestOrgLogoUpload(teamId: string, data: { mime: OrgLogoMime; size: number }) {
  return unwrap<OrgLogoUploadDraft>(teamsApi[':teamId'].logo.$post({ param: { teamId }, json: data }))
}

export function commitOrgLogo(teamId: string, data: { mime: OrgLogoMime }) {
  return unwrap<{ logo: string }>(teamsApi[':teamId'].logo.commit.$post({ param: { teamId }, json: data }))
}

export async function deleteOrgLogo(teamId: string) {
  const res = await teamsApi[':teamId'].logo.$delete({ param: { teamId } })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as ApiErrorBody
    throw new ApiError(res.status, { ...parsed, error: parsed.error ?? res.statusText })
  }
}
