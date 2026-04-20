import type {
  AdminInviteCodesRoute,
  AdminQuotasRoute,
  AuthProvidersRoute,
  EmailConfigRoute,
  NotificationsRoute,
  ObjectsRoute,
  ProfileRoute,
  PublicTeamsRoute,
  StoragesRoute,
  SystemRoute,
  TeamsRoute,
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
export const authProviders = hc<AuthProvidersRoute>('/api/auth-providers', opts)
export const inviteCodes = hc<AdminInviteCodesRoute>('/api/admin/invite-codes', opts)
export const emailConfig = hc<EmailConfigRoute>('/api/admin/email-config', opts)
export const profiles = hc<ProfileRoute>('/api/profiles')
export const teamsApi = hc<TeamsRoute>('/api/teams', opts)
export const publicTeamsApi = hc<PublicTeamsRoute>('/api/teams')
export const notificationsApi = hc<NotificationsRoute>('/api/notifications', opts)
