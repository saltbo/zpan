import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { StorageObject } from '@zpan/shared'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export function useRestoreObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<StorageObject>(`/api/objects/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function usePermanentlyDeleteObject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson<undefined>(`/api/objects/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}

export function useEmptyTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fetchJson<undefined>('/api/objects/trash', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
  })
}
