// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  ActivityRepo,
  AnnouncementRepo,
  ArchiveJobsGateway,
  BackgroundJobRepo,
  CfHostnamesProvider,
  ChangelogProvider,
  ImageHostingConfigRepo,
  ImageUpload,
  InstanceRepo,
  InviteRepo,
  LicenseBindingRepo,
  NotificationRepo,
  ObjectUploadSessionRepo,
  OrgRepo,
  ProfileRepo,
  QuotaRepo,
  S3Gateway,
  SiteInvitationRepo,
  StorageRepo,
  StorageUsageRepo,
  SystemOptionsRepo,
  TeamInviteRepo,
  TeamRepo,
  UserAdminRepo,
  ZipGateway,
  ZipPlanRepo,
} from './ports'

export interface Deps {
  activity: ActivityRepo
  announcements: AnnouncementRepo
  archiveJobs: ArchiveJobsGateway
  backgroundJobs: BackgroundJobRepo
  cfHostnames: CfHostnamesProvider
  changelog: ChangelogProvider
  invites: InviteRepo
  imageHostingConfigs: ImageHostingConfigRepo
  imageUpload: ImageUpload
  instance: InstanceRepo
  licenseBinding: LicenseBindingRepo
  notifications: NotificationRepo
  objectUploadSessions: ObjectUploadSessionRepo
  org: OrgRepo
  profiles: ProfileRepo
  quota: QuotaRepo
  s3: S3Gateway
  siteInvitations: SiteInvitationRepo
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  systemOptions: SystemOptionsRepo
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  userAdmin: UserAdminRepo
  zip: ZipGateway
  zipPlan: ZipPlanRepo
}
