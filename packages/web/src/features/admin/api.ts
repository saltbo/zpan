import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Storage, PaginatedResponse, SystemOption } from '@zpan/shared/types'

export interface User {
  id: string
  name: string
  email: string
  image: string | null
  role: string
  banned: boolean
  quota: number
  quotaUsed: number
  createdAt: string
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

// --- Storages ---

export function useStorages() {
  return useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: () => apiFetch<{ items: Storage[]; total: number }>('/api/storages'),
  })
}

export function useCreateStorage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch('/api/storages', {
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
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/storages/${id}`, {
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
    mutationFn: (id: string) => apiFetch(`/api/storages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'storages'] }),
  })
}

// --- Users ---

export function useUsers(page: number, pageSize: number, search: string) {
  return useQuery({
    queryKey: ['admin', 'users', { page, pageSize, search }],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (search) params.set('search', search)
      return apiFetch<PaginatedResponse<User>>(`/api/users?${params}`)
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiFetch(`/api/users/${id}`, {
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
    mutationFn: (id: string) => apiFetch(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

// --- System Options ---

export function useSystemOption(key: string) {
  return useQuery({
    queryKey: ['admin', 'system', key],
    queryFn: () => apiFetch<SystemOption>(`/api/system/options/${key}`),
  })
}

export function useSetSystemOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiFetch(`/api/system/options/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['admin', 'system', vars.key] }),
  })
}
