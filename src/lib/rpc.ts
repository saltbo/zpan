import type {
  AdminAuthProvidersRoute,
  AdminInviteCodesRoute,
  AdminQuotasRoute,
  AuthedSharesRoute,
  AuthProvidersRoute,
  BrandingAdminRoute,
  EmailConfigRoute,
  IhostConfigRoute,
  IhostRoute,
  LicensingAdminRoute,
  LicensingRoute,
  MeRoute,
  NotificationsRoute,
  ObjectsRoute,
  ProfileRoute,
  PublicBrandingRoute,
  PublicSharesRoute,
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
export const trash = hc<TrashRoute>('/api/trash', opts)
export const storages = hc<StoragesRoute>('/api/admin/storages', opts)
export const users = hc<UsersRoute>('/api/admin/users', opts)
export const adminQuotas = hc<AdminQuotasRoute>('/api/admin/quotas', opts)
export const userQuotas = hc<UserQuotasRoute>('/api/quotas', opts)
export const system = hc<SystemRoute>('/api/system', opts)
export const authProviders = hc<AuthProvidersRoute>('/api/auth-providers', opts)
export const adminAuthProviders = hc<AdminAuthProvidersRoute>('/api/admin/auth-providers', opts)
export const inviteCodes = hc<AdminInviteCodesRoute>('/api/admin/invite-codes', opts)
export const emailConfig = hc<EmailConfigRoute>('/api/admin/email-config', opts)
export const profiles = hc<ProfileRoute>('/api/profiles')
export const meApi = hc<MeRoute>('/api/me', opts)
export const teamsApi = hc<TeamsRoute>('/api/teams', opts)
export const publicTeamsApi = hc<PublicTeamsRoute>('/api/teams')
export const notificationsApi = hc<NotificationsRoute>('/api/notifications', opts)

// Shares are a single resource; separate clients only because Hono RPC types
// are split across two sub-apps (public vs. authed) mounted at the same path.
export const publicSharesApi = hc<PublicSharesRoute>('/api/shares', opts)
export const authedSharesApi = hc<AuthedSharesRoute>('/api/shares', opts)

export const ihostConfigApi = hc<IhostConfigRoute>('/api/ihost/config', opts)
export const ihostApi = hc<IhostRoute>('/api/ihost', opts)
export const licensingApi = hc<LicensingRoute>('/api/licensing', opts)
export const licensingAdminApi = hc<LicensingAdminRoute>('/api/licensing', opts)
export const publicBrandingApi = hc<PublicBrandingRoute>('/api/branding', opts)
export const brandingAdminApi = hc<BrandingAdminRoute>('/api/admin/branding', opts)
