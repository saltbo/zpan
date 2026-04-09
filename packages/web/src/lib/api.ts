import type { PaginatedResponse, StorageObject } from '@zpan/shared/types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CREDENTIALS: RequestCredentials = 'include'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: CREDENTIALS, ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? res.statusText)
  }
  return res.json()
}

export function listObjects(parent: string, status = 'active', page = 1, pageSize = 500) {
  const params = new URLSearchParams({ parent, status, page: String(page), pageSize: String(pageSize) })
  return request<PaginatedResponse<StorageObject>>(`/api/objects?${params}`)
}

export function getObject(id: string) {
  return request<StorageObject & { downloadUrl?: string }>(`/api/objects/${id}`)
}

export interface CreateObjectInput {
  name: string
  type: string
  size?: number
  parent: string
  dirtype: number
}

export interface CreateObjectResult extends StorageObject {
  uploadUrl?: string
}

export function createObject(data: CreateObjectInput) {
  return request<CreateObjectResult>('/api/objects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  })
}

export function updateObject(id: string, data: { name?: string; parent?: string }) {
  return request<StorageObject>(`/api/objects/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  })
}

export function confirmUpload(id: string) {
  return request<StorageObject>(`/api/objects/${id}/done`, { method: 'PATCH' })
}

export function deleteObject(id: string) {
  return request<{ id: string; deleted: boolean }>(`/api/objects/${id}`, {
    method: 'DELETE',
  })
}

export function copyObject(id: string, parent: string) {
  return request<StorageObject>(`/api/objects/${id}/copy`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ parent }),
  })
}

export function uploadToS3(url: string, file: File): Promise<void> {
  return fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  }).then((res) => {
    if (!res.ok) throw new Error('Upload failed')
  })
}
