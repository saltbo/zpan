import type { PaginatedResponse, StorageObject } from '@zpan/shared/types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CREDENTIALS: RequestCredentials = 'include'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: CREDENTIALS, ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

export interface FetchObjectsParams {
  parent?: string
  status?: string
  type?: string
  search?: string
  page?: number
  pageSize?: number
}

export function fetchObjects(params: FetchObjectsParams) {
  const query = new URLSearchParams()
  if (params.parent) query.set('parent', params.parent)
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  return request<PaginatedResponse<StorageObject>>(`/api/objects?${query}`)
}

export function fetchObject(id: string) {
  return request<{ matter: StorageObject; downloadUrl?: string }>(`/api/objects/${id}`)
}

export interface CreateObjectInput {
  name: string
  type: string
  size?: number
  parent: string
  dirtype: number
}

export function createObject(input: CreateObjectInput) {
  return request<{ matter: StorageObject; uploadUrl?: string }>('/api/objects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  })
}

export function updateObject(id: string, data: { name?: string; parent?: string }) {
  return request<{ matter: StorageObject }>(`/api/objects/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  })
}

export function updateObjectStatus(id: string, status: string) {
  return request<{ matter: StorageObject }>(`/api/objects/${id}/status`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ status }),
  })
}

export function deleteObject(id: string) {
  return request<void>(`/api/objects/${id}`, { method: 'DELETE' })
}

export function copyObject(id: string, parent: string) {
  return request<{ matter: StorageObject }>(`/api/objects/${id}/copy`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ parent }),
  })
}

export function uploadToPresignedUrl(url: string, file: File, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed: ${xhr.status}`))
    })

    xhr.addEventListener('error', () => reject(new Error('Upload network error')))
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

    xhr.send(file)
  })
}
