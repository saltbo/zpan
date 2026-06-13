// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  ActivityRepo,
  AnnouncementRepo,
  BackgroundJobRepo,
  InviteRepo,
  NotificationRepo,
  OrgRepo,
  ProfileRepo,
  QuotaRepo,
  SiteInvitationRepo,
  StorageRepo,
  TeamInviteRepo,
  TeamRepo,
  UserAdminRepo,
} from './ports'

export interface Deps {
  activity: ActivityRepo
  announcements: AnnouncementRepo
  backgroundJobs: BackgroundJobRepo
  invites: InviteRepo
  notifications: NotificationRepo
  org: OrgRepo
  profiles: ProfileRepo
  quota: QuotaRepo
  siteInvitations: SiteInvitationRepo
  storages: StorageRepo
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  userAdmin: UserAdminRepo
}
