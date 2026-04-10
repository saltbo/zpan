import type { CreateStorageInput, UpdateStorageInput } from '@zpan/shared/schemas'
import type { PaginatedResponse, Storage, StorageObject } from '@zpan/shared/types'
import { adminQuotas, objects, storages, system, trash, userQuotas, users } from './rpc'

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

export function restoreObject(id: string) {
  return unwrap<StorageObject>(objects[':id'].restore.$patch({ param: { id } }))
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
