import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { StorageObject, PaginatedResponse } from '@zpan/shared'

interface ListParams {
  parent?: string
  status?: string
  type?: string
  search?: string
  page?: number
  pageSize?: number
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function objectsQueryKey(params: ListParams) {
  return ['objects', params] as const
}

export function useObjects(params: ListParams) {
  return useQuery({
    queryKey: objectsQueryKey(params),
    queryFn: () => {
      const sp = new URLSearchParams()
      if (params.parent !== undefined) sp.set('parent', params.parent)
      if (params.status) sp.set('status', params.status)
      if (params.type) sp.set('type', params.type)
      if (params.search) sp.set('search', params.search)
      if (params.page) sp.set('page', String(params.page))
      if (params.pageSize) sp.set('pageSize', String(params.pageSize))
      return fetchJson<PaginatedResponse<StorageObject>>(`/api/objects?${sp}`)
    },
  })
}

export function useObjectDetail(id: string | null) {
  return useQuery({
    queryKey: ['objects', id],
    queryFn: () => fetchJson<StorageObject & { downloadUrl?: string }>(`/api/objects/${id}`),
    enabled: !!id,
  })
}

export function useCreateObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string
      type: string
      size?: number
      parent?: string
      dirtype?: number
    }) =>
      fetchJson<{ matter?: StorageObject; uploadUrl?: string } & StorageObject>('/api/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useConfirmUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<StorageObject>(`/api/objects/${id}/uploaded`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useUpdateObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; parent?: string }) =>
      fetchJson<StorageObject>(`/api/objects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useTrashObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<StorageObject>(`/api/objects/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'trashed' }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useCopyObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parent }: { id: string; parent: string }) =>
      fetchJson<StorageObject>(`/api/objects/${id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export async function uploadToPresignedUrl(
  url: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: ${xhr.status}`))
    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.send(file)
  })
}
