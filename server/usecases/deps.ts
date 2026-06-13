// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  ActivityRepo,
  AnnouncementRepo,
  ApiKeyGateway,
  ArchiveJobsGateway,
  ArchiveTargetFolderRepo,
  BackgroundJobRepo,
  CfHostnamesProvider,
  ChangelogProvider,
  CloudStoreRepo,
  CloudTrafficReportRepo,
  DownloadTokenGateway,
  EmailGateway,
  ImageHostingConfigRepo,
  ImageHostingRepo,
  ImageUpload,
  InstanceRepo,
  InviteRepo,
  LicenseBindingRepo,
  LicensingCloudGateway,
  MemberCountRepo,
  NotificationRepo,
  ObjectUploadSessionRepo,
  OrgRepo,
  ProfileRepo,
  QuotaRepo,
  RemoteDownloadUsageRepo,
  S3Gateway,
  ShareNotificationRepo,
  ShareRepo,
  SiteInvitationRepo,
  StorageRepo,
  StorageUsageRepo,
  SystemOptionsRepo,
  TeamInviteRepo,
  TeamRepo,
  UserAdminRepo,
  WebDavPathRepo,
  WebDavStateRepo,
  ZipGateway,
  ZipPlanRepo,
} from './ports'

export interface Deps {
  activity: ActivityRepo
  announcements: AnnouncementRepo
  apiKeys: ApiKeyGateway
  archiveJobs: ArchiveJobsGateway
  archiveTargetFolders: ArchiveTargetFolderRepo
  backgroundJobs: BackgroundJobRepo
  cfHostnames: CfHostnamesProvider
  changelog: ChangelogProvider
  cloudStore: CloudStoreRepo
  cloudTrafficReports: CloudTrafficReportRepo
  downloadTokens: DownloadTokenGateway
  email: EmailGateway
  invites: InviteRepo
  imageHostingConfigs: ImageHostingConfigRepo
  imageHosting: ImageHostingRepo
  imageUpload: ImageUpload
  instance: InstanceRepo
  licenseBinding: LicenseBindingRepo
  licensingCloud: LicensingCloudGateway
  memberCount: MemberCountRepo
  notifications: NotificationRepo
  objectUploadSessions: ObjectUploadSessionRepo
  org: OrgRepo
  profiles: ProfileRepo
  quota: QuotaRepo
  remoteDownloadUsage: RemoteDownloadUsageRepo
  s3: S3Gateway
  shareNotifications: ShareNotificationRepo
  share: ShareRepo
  siteInvitations: SiteInvitationRepo
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  systemOptions: SystemOptionsRepo
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  userAdmin: UserAdminRepo
  webdavPath: WebDavPathRepo
  webdavState: WebDavStateRepo
  zip: ZipGateway
  zipPlan: ZipPlanRepo
}
