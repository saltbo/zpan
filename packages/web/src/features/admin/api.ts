import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Storage, PaginatedResponse, SystemOption, StorageQuota } from '@zpan/shared'

export interface AdminUser {
  id: string
  name: string
  email: string
  image: string | null
  role: string
  banned: boolean
  banReason: string | null
  banExpires: number | null
  createdAt: string
  updatedAt: string
  quota: StorageQuota | null
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

// --- Storages ---

export function useStorages() {
  return useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: () => fetchJson<{ items: Storage[]; total: number }>('/api/storages'),
  })
}

export function useCreateStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson<Storage>('/api/storages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

export function useUpdateStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      fetchJson<Storage>(`/api/storages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

export function useDeleteStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson<undefined>(`/api/storages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

// --- Users ---

interface UsersParams {
  page?: number
  pageSize?: number
  search?: string
}

function usersQueryKey(params: UsersParams) {
  return ['admin', 'users', params] as const
}

export function useUsers(params: UsersParams) {
  return useQuery({
    queryKey: usersQueryKey(params),
    queryFn: () => {
      const sp = new URLSearchParams()
      if (params.page) sp.set('page', String(params.page))
      if (params.pageSize) sp.set('pageSize', String(params.pageSize))
      if (params.search) sp.set('search', params.search)
      return fetchJson<PaginatedResponse<AdminUser>>(`/api/users?${sp}`)
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string
      role?: string
      banned?: boolean
      quota?: number
    }) =>
      fetchJson<AdminUser>(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson<undefined>(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

// --- System Options ---

export function useSystemOption(key: string) {
  return useQuery({
    queryKey: ['admin', 'system', key],
    queryFn: () => fetchJson<{ key: string; value: string }>(`/api/system/options/${key}`),
    retry: false,
  })
}

export function useSetSystemOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      fetchJson<SystemOption>(`/api/system/options/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, public: true }),
      }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['admin', 'system', vars.key] }),
  })
}
