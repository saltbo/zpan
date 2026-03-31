import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Storage, PaginatedResponse, SystemOption } from '@zpan/shared/types'

export interface User {
  id: string
  name: string
  email: string
  image: string | null
  role: string
  banned: boolean
  createdAt: string
  updatedAt: string
  quota?: { quota: number; used: number }
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// --- Storages ---

export function useStorages() {
  return useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: () => fetchJSON<Storage[]>('/api/storages'),
  })
}

export function useCreateStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchJSON<Storage>('/api/storages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

export function useUpdateStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown> & { id: string }) =>
      fetchJSON<Storage>(`/api/storages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

export function useDeleteStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJSON(`/api/storages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

// --- Users ---

export function useUsers(page: number, search: string) {
  return useQuery({
    queryKey: ['admin', 'users', { page, search }],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
      })
      if (search) params.set('search', search)
      return fetchJSON<PaginatedResponse<User>>(`/api/users?${params}`)
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) =>
      fetchJSON<User>(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJSON(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

// --- System Options ---

export function useSystemOption(key: string) {
  return useQuery({
    queryKey: ['admin', 'system', key],
    queryFn: () => fetchJSON<SystemOption>(`/api/system/options/${key}`),
  })
}

export function useUpdateSystemOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      fetchJSON<SystemOption>(`/api/system/options/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }),
    onSuccess: (_data, { key }) => qc.invalidateQueries({ queryKey: ['admin', 'system', key] }),
  })
}
