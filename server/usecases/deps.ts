// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  ActivityRepo,
  AnnouncementRepo,
  BackgroundJobRepo,
  CfHostnamesProvider,
  ChangelogProvider,
  InstanceRepo,
  InviteRepo,
  LicenseBindingRepo,
  NotificationRepo,
  OrgRepo,
  ProfileRepo,
  QuotaRepo,
  S3Gateway,
  SiteInvitationRepo,
  StorageRepo,
  SystemOptionsRepo,
  TeamInviteRepo,
  TeamRepo,
  UserAdminRepo,
} from './ports'

export interface Deps {
  activity: ActivityRepo
  announcements: AnnouncementRepo
  backgroundJobs: BackgroundJobRepo
  cfHostnames: CfHostnamesProvider
  changelog: ChangelogProvider
  invites: InviteRepo
  instance: InstanceRepo
  licenseBinding: LicenseBindingRepo
  notifications: NotificationRepo
  org: OrgRepo
  profiles: ProfileRepo
  quota: QuotaRepo
  s3: S3Gateway
  siteInvitations: SiteInvitationRepo
  storages: StorageRepo
  systemOptions: SystemOptionsRepo
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  userAdmin: UserAdminRepo
}
