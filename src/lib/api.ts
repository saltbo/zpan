import type { OAuthProviderConfig } from '@shared/oauth-providers'
import type { CreateStorageInput, UpdateStorageInput } from '@shared/schemas'
import type { AuthProvider, PaginatedResponse, Storage, StorageObject } from '@shared/types'
import {
  adminQuotas,
  authProviders,
  emailConfig,
  inviteCodes,
  objects,
  storages,
  system,
  trash,
  userQuotas,
  users,
} from './rpc'

export type { Storage, StorageObject }

async function unwrap<T>(promise: Promise<Response>): Promise<T> {
  const res = await promise
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
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

export function createObject(data: { name: string; type: string; size?: number; parent: string; dirtype: number }) {
  return unwrap<CreateObjectResult>(objects.index.$post({ json: data }))
}

export function updateObject(id: string, data: { name?: string; parent?: string }) {
  return unwrap<StorageObject>(objects[':id'].$patch({ param: { id }, json: data }))
}

export function confirmUpload(id: string) {
  return unwrap<StorageObject>(objects[':id'].done.$patch({ param: { id } }))
}

export function deleteObject(id: string) {
  return unwrap<{ id: string; deleted: boolean; purged?: number }>(objects[':id'].$delete({ param: { id } }))
}

export function copyObject(id: string, parent: string) {
  return unwrap<StorageObject>(objects[':id'].copy.$post({ param: { id }, json: { parent } }))
}

export function trashObject(id: string) {
  return unwrap<StorageObject>(objects[':id'].trash.$patch({ param: { id } }))
}

export function restoreObject(id: string) {
  return unwrap<StorageObject>(objects[':id'].restore.$patch({ param: { id } }))
}

export function batchMoveObjects(ids: string[], parent: string) {
  return unwrap<{ moved: number }>(objects.batch.move.$post({ json: { ids, parent } }))
}

export function batchTrashObjects(ids: string[]) {
  return unwrap<{ trashed: number }>(objects.batch.trash.$post({ json: { ids } }))
}

export function batchDeleteObjects(ids: string[]) {
  return unwrap<{ deleted: number }>(objects.batch.delete.$post({ json: { ids } }))
}

export function emptyTrash() {
  return unwrap<{ purged: number }>(trash.empty.$post())
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
  return unwrap<{ id: string; status: string }>(users[':id'].status.$put({ param: { id: userId }, json: { status } }))
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
  return unwrap<{ items: OAuthProviderConfig[] }>(authProviders.admin.$get())
}

export function upsertAuthProvider(providerId: string, data: Omit<OAuthProviderConfig, 'providerId'>) {
  return unwrap<OAuthProviderConfig>(authProviders.admin[':providerId'].$put({ param: { providerId }, json: data }))
}

export function deleteAuthProvider(providerId: string) {
  return unwrap<{ providerId: string; deleted: boolean }>(
    authProviders.admin[':providerId'].$delete({ param: { providerId } }),
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
  return unwrap<{ success: boolean; error?: string }>(emailConfig.test.$post({ json: { to } }))
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
