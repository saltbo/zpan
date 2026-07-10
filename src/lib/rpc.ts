import type {
  AdminAuditRoute,
  AdminInviteCodesRoute,
  AdminQuotasRoute,
  AdminSiteInvitationsRoute,
  AdminStatsRoute,
  AdminTeamsRoute,
  AnnouncementsRoute,
  AuthedSharesRoute,
  AuthProvidersRoute,
  BackgroundJobsRoute,
  BrandingAdminRoute,
  CloudStoreRoute,
  DownloaderSelfRoute,
  DownloadersRoute,
  DownloadTasksRoute,
  EmailConfigRoute,
  EventsRoute,
  IhostConfigRoute,
  IhostRoute,
  LicensingAdminRoute,
  LicensingRoute,
  NotificationsRoute,
  ObjectsRoute,
  PublicBrandingRoute,
  PublicSharesRoute,
  PublicSiteInvitationsRoute,
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
const absoluteUrlBase = (path: string) => {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  return new URL(path, origin).toString()
}

export const objects = hc<ObjectsRoute>('/api/objects', opts)
export const downloadTasksApi = hc<DownloadTasksRoute>('/api/downloads/tasks', opts)
export const downloaderSelfApi = hc<DownloaderSelfRoute>('/api/downloads/downloaders', opts)
export const trash = hc<TrashRoute>('/api/trash', opts)
export const storages = hc<StoragesRoute>('/api/site/storages', opts)
export const adminDownloadersApi = hc<DownloadersRoute>('/api/downloads/downloaders', opts)
// One users resource: self (/me/avatar), public profile (/:username), and admin management.
export const users = hc<UsersRoute>('/api/users', opts)
export const adminQuotas = hc<AdminQuotasRoute>('/api/quotas', opts)
export const adminTeams = hc<AdminTeamsRoute>('/api/teams', opts)
export const userQuotas = hc<UserQuotasRoute>('/api/quotas', opts)
export const cloudStoreApi = hc<CloudStoreRoute>('/api/store', opts)
export const system = hc<SystemRoute>('/api/site', opts)
// One auth-providers resource (public list + admin CRUD, gated per-route).
export const authProviders = hc<AuthProvidersRoute>('/api/site/auth-providers', opts)
export const inviteCodes = hc<AdminInviteCodesRoute>('/api/site/invite-codes', opts)
export const adminSiteInvitations = hc<AdminSiteInvitationsRoute>('/api/site/invitations', opts)
export const emailConfig = hc<EmailConfigRoute>('/api/site/email', opts)
export const teamsApi = hc<TeamsRoute>('/api/teams', opts)
export const publicTeamsApi = hc<PublicTeamsRoute>('/api/teams')
export const notificationsApi = hc<NotificationsRoute>('/api/notifications', opts)
// One announcements resource (user feed + admin management, gated per-route).
export const announcementsApi = hc<AnnouncementsRoute>('/api/site/announcements', opts)
export const backgroundJobsApi = hc<BackgroundJobsRoute>('/api/background-jobs', opts)
export const eventsUrlApi = hc<EventsRoute>(absoluteUrlBase('/api/events'), opts)

// Shares are a single resource; separate clients only because Hono RPC types
// are split across two sub-apps (public vs. authed) mounted at the same path.
export const publicSharesApi = hc<PublicSharesRoute>('/api/shares', opts)
export const authedSharesApi = hc<AuthedSharesRoute>('/api/shares', opts)

export const ihostConfigApi = hc<IhostConfigRoute>('/api/image-hosting/config', opts)
export const ihostApi = hc<IhostRoute>('/api/image-hosting', opts)
export const licensingApi = hc<LicensingRoute>('/api/site/licensing', opts)
export const licensingAdminApi = hc<LicensingAdminRoute>('/api/site/licensing', opts)
export const publicBrandingApi = hc<PublicBrandingRoute>('/api/site/branding', opts)
export const brandingAdminApi = hc<BrandingAdminRoute>('/api/site/branding', opts)
export const adminAuditApi = hc<AdminAuditRoute>('/api/site/audit-events', opts)
export const siteStatsApi = hc<AdminStatsRoute>('/api/site/stats', opts)
export const publicSiteInvitations = hc<PublicSiteInvitationsRoute>('/api/site/invitations', opts)
