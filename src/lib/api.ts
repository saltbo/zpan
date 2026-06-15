import { ApiKeyTemplate } from '@shared/api-key-templates'
import type { OAuthProviderConfig } from '@shared/oauth-providers'
import type {
  AllowedImageMime,
  AnnouncementInput,
  CloudCreditBalanceResponse,
  CloudCreditLedgerResponse,
  ConflictStrategy,
  CreateBackgroundJobRequest,
  CreateDownloadTaskInput,
  CreateObjectUploadSessionInput,
  CreateShareRequest,
  CreateStorageInput,
  DiscountQuote,
  DownloaderHeartbeatInput,
  DownloadTaskActionInput,
  PatchObjectUploadSessionInput,
  PresignObjectUploadPartsInput,
  RedeemGiftCardResponse,
  UpdateDownloaderInput,
  UpdateDownloadTaskInput,
  UpdateStorageInput,
} from '@shared/schemas'
import type {
  ActivityEvent,
  AdminAuditEvent,
  Announcement,
  AuthProvider,
  BackgroundJob,
  BackgroundJobStatus,
  BindingState,
  BrandingConfig,
  BrandingField,
  BrandingThemeMode,
  BrandingThemePresetId,
  BrandingThemeValues,
  ChangelogInfo,
  CloudOrder,
  CloudProduct,
  CloudStoreTarget,
  Downloader,
  DownloadTask,
  IhostConfigResponse,
  ImageHosting,
  InstanceInfo,
  Notification,
  ObjectUploadSession,
  OrgQuota,
  OrgQuotaEntitlement,
  PaginatedResponse,
  ShareListItem,
  ShareView,
  SiteInvitation,
  Storage,
  StorageObject,
} from '@shared/types'
import {
  adminAuditApi,
  adminDownloadersApi,
  adminQuotas,
  adminSiteInvitations,
  adminTeams,
  announcementsApi,
  authedSharesApi,
  authProviders,
  backgroundJobsApi,
  brandingAdminApi,
  cloudStoreApi,
  downloaderSelfApi,
  downloadTasksApi,
  emailConfig,
  eventsUrlApi,
  ihostApi,
  ihostConfigApi,
  inviteCodes,
  licensingAdminApi,
  licensingApi,
  notificationsApi,
  objects,
  publicBrandingApi,
  publicSharesApi,
  publicSiteInvitations,
  storages,
  system,
  teamsApi,
  trash,
  userQuotas,
  users,
} from './rpc'

export type { Storage, StorageObject }

export type UserQuota = Pick<
  OrgQuota,
  | 'orgId'
  | 'baseQuota'
  | 'entitlementQuota'
  | 'quota'
  | 'used'
  | 'baseTrafficQuota'
  | 'entitlementTrafficQuota'
  | 'trafficQuota'
  | 'trafficUsed'
  | 'trafficPeriod'
  | 'storagePlanName'
  | 'storageExtraNames'
  | 'trafficPlanName'
  | 'trafficExtraNames'
  | 'currentPlan'
>

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

const SESSION_REQUEST_TIMEOUT_MS = 10_000

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
  opts?: { type?: string; search?: string; orgId?: string },
) {
  const query: Record<string, string> = { path, status, page: String(page), pageSize: String(pageSize) }
  if (opts?.type) query.type = opts.type
  if (opts?.search) query.search = opts.search
  if (opts?.orgId) query.orgId = opts.orgId
  return unwrap<PaginatedResponse<StorageObject>>(objects.index.$get({ query }))
}

export function getObject(id: string) {
  return unwrap<StorageObject & { downloadUrl?: string }>(objects[':id'].$get({ param: { id } }))
}

export interface CreateObjectResult extends StorageObject {
  uploadUrl?: string
  contentDisposition?: string
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
  return unwrap<StorageObject>(objects[':id'].$patch({ param: { id }, json: data }))
}

export function confirmUpload(id: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(
    objects[':id'].status.$put({ param: { id }, json: { status: 'active' as const, onConflict } }),
  )
}

export function cancelUpload(id: string) {
  return unwrap<{ id: string; deleted: boolean; purged?: number }>(objects[':id'].$delete({ param: { id } }))
}

export function deleteObject(id: string) {
  return unwrap<{ id: string; deleted: boolean; purged?: number }>(objects[':id'].$delete({ param: { id } }))
}

export function copyObject(id: string, parent: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(objects[':id'].copies.$post({ param: { id }, json: { parent, onConflict } }))
}

export interface TransferObjectResult {
  saved: StorageObject[]
  skipped: Array<{ name: string; reason: string }>
  sourceDeleted: boolean
}

export function transferObject(
  id: string,
  input: { targetOrgId: string; targetParent: string; mode: 'copy' | 'move' },
) {
  return unwrap<TransferObjectResult>(objects[':id'].transfers.$post({ param: { id }, json: input }))
}

export function trashObject(id: string) {
  return unwrap<StorageObject>(objects[':id'].status.$put({ param: { id }, json: { status: 'trashed' as const } }))
}

export function restoreObject(id: string, onConflict?: ConflictStrategy) {
  return unwrap<StorageObject>(
    objects[':id'].status.$put({ param: { id }, json: { status: 'active' as const, onConflict } }),
  )
}

export function emptyTrash() {
  return unwrap<{ purged: number }>(trash.index.$delete())
}

export function createObjectUploadSession(id: string, data: CreateObjectUploadSessionInput) {
  return unwrap<ObjectUploadSession & { object: StorageObject }>(
    objects[':id'].uploads.$post({ param: { id }, json: data }),
  )
}

export function presignObjectUploadParts(id: string, uploadSessionId: string, data: PresignObjectUploadPartsInput) {
  return unwrap<{ uploadId: string; partSize: number; parts: Array<{ partNumber: number; url: string }> }>(
    objects[':id'].uploads[':uploadSessionId'].parts.$post({
      param: { id, uploadSessionId },
      json: data,
    }),
  )
}

export function patchObjectUploadSession(id: string, uploadSessionId: string, data: PatchObjectUploadSessionInput) {
  if (data.action === 'complete') {
    return unwrap<ObjectUploadSession & { object?: StorageObject }>(
      objects[':id'].uploads[':uploadSessionId'].status.$put({
        param: { id, uploadSessionId },
        json: { status: 'completed' as const, parts: data.parts },
      }),
    )
  }
  return unwrap<ObjectUploadSession & { object?: StorageObject }>(
    objects[':id'].uploads[':uploadSessionId'].$delete({ param: { id, uploadSessionId } }),
  )
}

// Remote Download API

export interface ListDownloadTasksOptions {
  status?: string
  assignedTo?: 'me'
  category?: string
  tag?: string
  sortBy?: 'createdAt' | 'source' | 'category' | 'tags' | 'status' | 'progress' | 'eta'
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export function listDownloadTasks(opts: ListDownloadTasksOptions = {}) {
  const query: Record<string, string> = {
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 50),
  }
  if (opts.status) query.status = opts.status
  if (opts.assignedTo) query.assignedTo = opts.assignedTo
  if (opts.category) query.category = opts.category
  if (opts.tag) query.tag = opts.tag
  if (opts.sortBy) query.sortBy = opts.sortBy
  if (opts.sortDir) query.sortDir = opts.sortDir
  return unwrap<PaginatedResponse<DownloadTask>>(downloadTasksApi.index.$get({ query }))
}

export function createDownloadTask(data: CreateDownloadTaskInput) {
  return unwrap<DownloadTask>(downloadTasksApi.index.$post({ json: data }))
}

export function updateDownloadTask(id: string, data: UpdateDownloadTaskInput) {
  return unwrap<DownloadTask>(downloadTasksApi[':id'].$patch({ param: { id }, json: data }))
}

export type DownloadTaskActionResult = DownloadTask | { id: string; deleted: true }

export function runDownloadTaskAction(id: string, action: DownloadTaskActionInput['action']) {
  if (action === 'delete') {
    return unwrap<DownloadTaskActionResult>(downloadTasksApi[':id'].$delete({ param: { id } }))
  }
  if (action === 'retry' || action === 'restart') {
    return unwrap<DownloadTaskActionResult>(
      downloadTasksApi[':id'].attempts.$post({ param: { id }, json: { fresh: action === 'restart' } }),
    )
  }
  const status =
    action === 'pause' ? ('paused' as const) : action === 'resume' ? ('queued' as const) : ('canceled' as const)
  return unwrap<DownloadTaskActionResult>(downloadTasksApi[':id'].status.$put({ param: { id }, json: { status } }))
}

// Unified server-sent events stream (background jobs, notifications, and the
// opt-in download-tasks domain). Consumed by a raw EventSource in useServerEvents,
// so this only builds the URL; `query` carries the active page subscriptions.
export function serverEventsUrl(query: Record<string, string> = {}) {
  const url = eventsUrlApi.index.$url()
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url
}

export function listDownloaders() {
  return unwrap<PaginatedResponse<Downloader>>(adminDownloadersApi.index.$get())
}

export function updateDownloader(id: string, data: UpdateDownloaderInput) {
  return unwrap<Downloader>(adminDownloadersApi[':id'].$patch({ param: { id }, json: data }))
}

export function deleteDownloader(id: string) {
  return unwrap<{ id: string; deleted: true }>(adminDownloadersApi[':id'].$delete({ param: { id } }))
}

export function sendDownloaderHeartbeat(data: DownloaderHeartbeatInput) {
  return unwrap<Downloader>(downloaderSelfApi.me.heartbeats.$post({ json: data }))
}

// Background Jobs API

export interface ListBackgroundJobsOptions {
  status?: BackgroundJobStatus
  type?: string
  page?: number
  pageSize?: number
}

export function listBackgroundJobs(opts: ListBackgroundJobsOptions = {}) {
  const query: Record<string, string> = {
    page: String(opts.page ?? 1),
    pageSize: String(opts.pageSize ?? 20),
  }
  if (opts.status) query.status = opts.status
  if (opts.type) query.type = opts.type

  return unwrap<PaginatedResponse<BackgroundJob>>(backgroundJobsApi.index.$get({ query }))
}

export function createBackgroundJob(data: CreateBackgroundJobRequest) {
  return unwrap<BackgroundJob>(backgroundJobsApi.index.$post({ json: data }))
}

export function getBackgroundJob(id: string) {
  return unwrap<BackgroundJob>(backgroundJobsApi[':id'].$get({ param: { id } }))
}

export function cancelBackgroundJob(id: string) {
  return unwrap<BackgroundJob>(
    backgroundJobsApi[':id'].status.$put({ param: { id }, json: { status: 'canceled' as const } }),
  )
}

export function retryBackgroundJob(id: string) {
  return unwrap<BackgroundJob>(backgroundJobsApi[':id'].retries.$post({ param: { id } }))
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
  quotaDefault: number
  quotaTotal: number
}

export type UserEntitlementsResponse = { orgId: string; items: OrgQuotaEntitlement[] }

export function listUsers(page: number, pageSize: number, search?: string) {
  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize) }
  if (search?.trim()) query.search = search.trim()
  return unwrap<{ items: UserWithOrg[]; total: number }>(users.index.$get({ query }))
}

export function getUser(userId: string) {
  return unwrap<UserWithOrg>(users[':username'].$get({ param: { username: userId } }))
}

export function updateUserStatus(userId: string, status: 'active' | 'disabled') {
  return unwrap<{ id: string; status: string }>(
    users[':username'].$patch({ param: { username: userId }, json: { status } }),
  )
}

export function deleteUser(userId: string) {
  return unwrap<{ id: string; deleted: boolean }>(users[':username'].$delete({ param: { username: userId } }))
}

export function batchUpdateUserStatus(ids: string[], status: 'active' | 'disabled') {
  const action = status === 'disabled' ? 'disable' : 'enable'
  return unwrap<{ updated: number; ids: string[]; status: string }>(users.index.$patch({ json: { action, ids } }))
}

export function batchDeleteUsers(ids: string[]) {
  return unwrap<{ deleted: number; ids: string[] }>(users.index.$delete({ json: { ids } }))
}

export function listUserEntitlements(userId: string) {
  return unwrap<UserEntitlementsResponse>(users[':username'].entitlements.$get({ param: { username: userId } }))
}

export function grantUserEntitlement(
  userId: string,
  data: { resourceType: 'storage'; bytes: number; expiresAt?: string | null; note?: string | null },
) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    users[':username'].entitlements.$post({ param: { username: userId }, json: data }),
  )
}

export function updateUserEntitlement(
  userId: string,
  entitlementId: string,
  data: { bytes?: number; expiresAt?: string | null; note?: string | null },
) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    users[':username'].entitlements[':eid'].$patch({ param: { username: userId, eid: entitlementId }, json: data }),
  )
}

export function revokeUserEntitlement(userId: string, entitlementId: string) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    users[':username'].entitlements[':eid'].$delete({ param: { username: userId, eid: entitlementId } }),
  )
}

// Admin Quotas API

export type QuotaItem = Pick<
  OrgQuota,
  | 'orgId'
  | 'baseQuota'
  | 'entitlementQuota'
  | 'quota'
  | 'used'
  | 'baseTrafficQuota'
  | 'entitlementTrafficQuota'
  | 'trafficQuota'
  | 'trafficUsed'
  | 'trafficPeriod'
> & {
  orgName?: string
  orgType?: string
}

export function listQuotas() {
  return unwrap<{ items: QuotaItem[]; total: number }>(adminQuotas.index.$get())
}

// Admin Teams API

export interface TeamSummary {
  id: string
  name: string
  slug: string
  logo: string | null
  memberCount: number
  ownerName: string | null
  quotaUsed: number
  quotaTotal: number
  createdAt: number
}

export function listTeams() {
  return unwrap<{ items: TeamSummary[]; total: number }>(adminTeams.index.$get())
}

export function getTeam(orgId: string) {
  return unwrap<TeamSummary>(adminTeams[':teamId'].$get({ param: { teamId: orgId } }))
}

export function listOrgEntitlements(orgId: string) {
  return unwrap<{ orgId: string; items: OrgQuotaEntitlement[] }>(
    adminTeams[':teamId'].entitlements.$get({ param: { teamId: orgId } }),
  )
}

export function grantOrgEntitlement(
  orgId: string,
  data: { resourceType: 'storage'; bytes: number; expiresAt?: string | null; note?: string | null },
) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    adminTeams[':teamId'].entitlements.$post({ param: { teamId: orgId }, json: data }),
  )
}

export function updateOrgEntitlement(
  orgId: string,
  entitlementId: string,
  data: { bytes?: number; expiresAt?: string | null; note?: string | null },
) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    adminTeams[':teamId'].entitlements[':eid'].$patch({ param: { teamId: orgId, eid: entitlementId }, json: data }),
  )
}

export function revokeOrgEntitlement(orgId: string, entitlementId: string) {
  return unwrap<{ orgId: string; entitlement: OrgQuotaEntitlement }>(
    adminTeams[':teamId'].entitlements[':eid'].$delete({ param: { teamId: orgId, eid: entitlementId } }),
  )
}

// User Quotas API

export function getUserQuota() {
  return unwrap<UserQuota>(userQuotas.me.$get())
}

// Quota Store API

export function listCloudProducts() {
  return unwrap<{ items: CloudProduct[]; total: number }>(cloudStoreApi.packages.$get())
}

export function listCloudCreditProducts() {
  return unwrap<{ items: CloudProduct[]; total: number }>(cloudStoreApi.credits.products.$get())
}

export function listCloudStoreTargets() {
  return unwrap<{ items: CloudStoreTarget[]; total: number }>(cloudStoreApi.targets.$get())
}

export function getCloudCredits() {
  return unwrap<CloudCreditBalanceResponse>(cloudStoreApi.credits.$get())
}

export function listCloudCreditLedgerEntries() {
  return unwrap<CloudCreditLedgerResponse>(cloudStoreApi.credits['ledger-entries'].$get())
}

export function redeemCloudGiftCard(code: string) {
  return unwrap<RedeemGiftCardResponse>(cloudStoreApi.credits.redemptions.$post({ json: { code } }))
}

export function createCloudCheckout(packageId: string, priceId?: string, promotionCode?: string) {
  return unwrap<{ orderId: string; url: string; paymentId?: string }>(
    cloudStoreApi.checkouts.$post({ json: { packageId, priceId, promotionCode } }),
  )
}

export function createDiscountQuote(code: string, priceId: string) {
  return unwrap<DiscountQuote>(cloudStoreApi['discount-quotes'].$post({ json: { code, priceId } }))
}

export function createCloudBillingPortalSession() {
  return unwrap<{ url: string; stripeSubscriptionId: string }>(cloudStoreApi['billing-portal-sessions'].$post())
}

export function continueCloudOrderPayment(orderId: string) {
  return unwrap<{ orderId: string; url: string; paymentId?: string }>(
    cloudStoreApi.orders[':orderId'].payments.$post({ param: { orderId } }),
  )
}

export function cancelCloudOrder(orderId: string) {
  return unwrap<CloudOrder>(
    cloudStoreApi.orders[':orderId'].$patch({ param: { orderId }, json: { status: 'canceled' } }),
  )
}

export function listCloudOrders(options: { limit?: number; offset?: number } = {}) {
  const query = {
    ...(options.limit !== undefined ? { limit: String(options.limit) } : {}),
    ...(options.offset !== undefined ? { offset: String(options.offset) } : {}),
  }
  return unwrap<{ items: CloudOrder[]; total: number }>(cloudStoreApi.orders.$get({ query }))
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
  return unwrap<{ items: OAuthProviderConfig[] }>(authProviders.index.$get())
}

export function upsertAuthProvider(providerId: string, data: Omit<OAuthProviderConfig, 'providerId'>) {
  return unwrap<OAuthProviderConfig>(authProviders[':providerId'].$put({ param: { providerId }, json: data }))
}

export function deleteAuthProvider(providerId: string) {
  return unwrap<{ providerId: string; deleted: boolean }>(
    authProviders[':providerId'].$delete({ param: { providerId } }),
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
  return unwrap<{ items: InviteCode[]; total: number }>(
    inviteCodes.index.$get({ query: { page: String(page), pageSize: String(pageSize) } }),
  )
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
    adminSiteInvitations.index.$get({ query: { page: String(page), pageSize: String(pageSize) } }),
  )
}

export function createSiteInvitation(email: string) {
  return unwrap<SiteInvitation>(adminSiteInvitations.index.$post({ json: { email } }))
}

export function resendSiteInvitation(id: string) {
  return unwrap<SiteInvitation>(adminSiteInvitations[':id'].deliveries.$post({ param: { id } }))
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
  return unwrap<{ user: PublicUser; shares: PublicMatter[] }>(users[':username'].$get({ param: { username } }))
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
  const query: { scope: 'all'; page: string; pageSize: string; status?: Announcement['status'] } = {
    scope: 'all',
    page: String(page),
    pageSize: String(pageSize),
  }
  if (status) query.status = status
  return unwrap<AnnouncementListResult>(announcementsApi.index.$get({ query }))
}

export function createAnnouncement(data: AnnouncementInput) {
  return unwrap<Announcement>(announcementsApi.index.$post({ json: data }))
}

export function getAnnouncement(id: string) {
  return unwrap<Announcement>(announcementsApi[':id'].$get({ param: { id } }))
}

export function updateAnnouncement(id: string, data: AnnouncementInput) {
  return unwrap<Announcement>(announcementsApi[':id'].$put({ param: { id }, json: data }))
}

export function deleteAnnouncement(id: string) {
  return unwrap<{ id: string; deleted: boolean }>(announcementsApi[':id'].$delete({ param: { id } }))
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

export function listReceivedShares(page = 1, pageSize = 20) {
  const query: Record<string, string> = { page: String(page), pageSize: String(pageSize), box: 'received' }
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
  }).then((res) => res.apiKeys.filter((k) => k.permissions?.ihost?.includes('upload')))
}

export function createIhostApiKey(organizationId: string, name: string) {
  return apiKeyFetch<CreateIhostApiKeyResult>('/api-key/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      configId: ApiKeyTemplate.IHOST,
      name,
      organizationId,
    }),
  })
}

export function revokeIhostApiKey(keyId: string) {
  return apiKeyFetch<{ success: boolean }>('/api-key/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configId: ApiKeyTemplate.IHOST, keyId }),
  })
}

// WebDAV App Passwords (via better-auth apiKey plugin)

export type WebDavAppPassword = IhostApiKey

export interface CreateWebDavAppPasswordResult extends WebDavAppPassword {
  key: string
}

export function listWebDavAppPasswords() {
  return apiKeyFetch<{ apiKeys: WebDavAppPassword[] }>('/api-key/list?configId=webdav', {
    method: 'GET',
  }).then((res) => res.apiKeys.filter((k) => k.permissions?.webdav?.includes('read')))
}

export function createWebDavAppPassword(name: string) {
  return apiKeyFetch<CreateWebDavAppPasswordResult>('/api-key/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      configId: 'webdav',
      name,
    }),
  })
}

export function revokeWebDavAppPassword(keyId: string) {
  return apiKeyFetch<{ success: boolean }>('/api-key/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configId: 'webdav', keyId }),
  })
}

// Remote Download API Keys (via better-auth apiKey plugin)

export type RemoteDownloadApiKey = IhostApiKey

export interface CreateRemoteDownloadApiKeyResult extends RemoteDownloadApiKey {
  key: string
}

export function listRemoteDownloadApiKeys(organizationId: string) {
  return apiKeyFetch<{ apiKeys: RemoteDownloadApiKey[] }>(
    `/api-key/list?organizationId=${encodeURIComponent(organizationId)}&configId=${ApiKeyTemplate.REMOTE_DOWNLOAD}`,
    {
      method: 'GET',
    },
  ).then((res) => res.apiKeys.filter((k) => k.permissions?.remoteDownload?.includes('create')))
}

export function createRemoteDownloadApiKey(organizationId: string, name: string) {
  return apiKeyFetch<CreateRemoteDownloadApiKeyResult>('/api-key/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      configId: ApiKeyTemplate.REMOTE_DOWNLOAD,
      name,
      organizationId,
    }),
  })
}

export function revokeRemoteDownloadApiKey(keyId: string) {
  return apiKeyFetch<{ success: boolean }>('/api-key/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configId: ApiKeyTemplate.REMOTE_DOWNLOAD, keyId }),
  })
}

// Licensing API

export type { BindingState }

export interface PairingInfo {
  code: string
  pairingUrl: string
  expiresAt: string
}

export interface PairingPollResult {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  plan?: string
}

export function getLicensingStatus() {
  return unwrap<BindingState>(licensingApi.status.$get())
}

export function getInstanceInfo() {
  return unwrap<InstanceInfo>(system.instance.$get())
}

export function getChangelog(opts?: { refresh?: boolean }) {
  return unwrap<ChangelogInfo>(system.changelog.$get({ query: opts?.refresh ? { refresh: 'true' } : {} }))
}

export function connectCloud() {
  return unwrap<PairingInfo>(licensingAdminApi.pairings.$post())
}

export function pollPairing(code: string) {
  return unwrap<PairingPollResult>(licensingAdminApi.pairings[':code'].$get({ param: { code } }))
}

export function refreshLicense() {
  return unwrap<{ success: boolean; last_refresh_at: number | null }>(licensingAdminApi['refresh-runs'].$post())
}

export function disconnectCloud() {
  return unwrap<{ deleted: boolean }>(licensingAdminApi.binding.$delete())
}

type SessionData = { session: unknown; user: unknown } | null

const SESSION_CACHE_TTL_MS = 5000 // 5 seconds

let sessionCache: { value: SessionData; at: number } | null = null
let sessionInflight: Promise<SessionData> | null = null

export function clearSessionCache() {
  sessionCache = null
  sessionInflight = null
}

async function fetchSession(): Promise<SessionData> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), SESSION_REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include', signal: controller.signal })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as ApiErrorBody
      throw new ApiError(res.status, body)
    }
    return res.json()
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Session request timed out')
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

// Auth API — Better Auth passthrough, not typed via Hono RPC.
// Concurrent callers share one in-flight request no matter how long it takes;
// a resolved value is served for SESSION_CACHE_TTL_MS; failures are not cached.
export function getSession(): Promise<SessionData> {
  if (sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_TTL_MS) {
    return Promise.resolve(sessionCache.value)
  }
  if (sessionInflight) return sessionInflight

  const request = fetchSession()
    .then((value) => {
      sessionCache = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      if (sessionInflight === request) sessionInflight = null
    })
  sessionInflight = request
  return request
}

export interface UploadProgress {
  loaded: number
  total: number
}

export interface UploadToS3Options {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
  contentDisposition?: string
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
    if (options.contentDisposition) {
      xhr.setRequestHeader('Content-Disposition', options.contentDisposition)
    }
    xhr.send(file)
  })
}

export interface UploadPartOptions {
  onProgress?: (progress: UploadProgress) => void
  signal?: AbortSignal
}

/**
 * PUTs a single multipart part (external presigned URL) and resolves with its
 * ETag, which the multipart-complete call needs. The S3 bucket's CORS config
 * must expose the ETag response header for this to be readable from the browser.
 */
export function uploadPartToS3(url: string, blob: Blob, options: UploadPartOptions = {}): Promise<string> {
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
      options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : blob.size })
    }
    xhr.onload = () => {
      options.signal?.removeEventListener('abort', abort)
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(new Error('Missing ETag — the storage bucket must expose the ETag header via CORS'))
          return
        }
        options.onProgress?.({ loaded: blob.size, total: blob.size })
        resolve(etag.replace(/"/g, ''))
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
    xhr.send(blob)
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
  return unwrap<ImageHosting>(ihostApi.images[':id'].status.$put({ param: { id } }))
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
  return putImageMultipart('/api/users/me/avatar', file)
}

export async function deleteAvatar() {
  const res = await users.me.avatar.$delete()
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

  const res = await fetch('/api/site/branding', {
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
