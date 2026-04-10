import type {
  AdminQuotasRoute,
  ObjectsRoute,
  StoragesRoute,
  SystemRoute,
  TrashRoute,
  UserQuotasRoute,
  UsersRoute,
} from '@server/app'
import { hc } from 'hono/client'

const opts = { init: { credentials: 'include' as RequestCredentials } }

export const objects = hc<ObjectsRoute>('/api/objects', opts)
export const trash = hc<TrashRoute>('/api/recycle-bin', opts)
export const storages = hc<StoragesRoute>('/api/admin/storages', opts)
export const users = hc<UsersRoute>('/api/admin/users', opts)
export const adminQuotas = hc<AdminQuotasRoute>('/api/admin/quotas', opts)
export const userQuotas = hc<UserQuotasRoute>('/api/quotas', opts)
export const system = hc<SystemRoute>('/api/system', opts)
