// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  AdminStatsRepo,
  AnnouncementRepo,
  ApiKeyGateway,
  ArchiveJobsGateway,
  ArchiveTargetFolderRepo,
  AuditRepo,
  BackgroundJobRepo,
  CfHostnamesProvider,
  ChangelogProvider,
  CloudStoreRepo,
  CloudTrafficReportRepo,
  DownloaderRepo,
  DownloadTaskRepo,
  DownloadTokenGateway,
  EmailGateway,
  ImageHostingConfigRepo,
  ImageHostingRepo,
  ImageUpload,
  InstanceRepo,
  InviteRepo,
  LicenseBindingRepo,
  LicensingCloudGateway,
  MatterRepo,
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
  audit: AuditRepo
  adminStats: AdminStatsRepo
  announcements: AnnouncementRepo
  apiKeys: ApiKeyGateway
  archiveJobs: ArchiveJobsGateway
  archiveTargetFolders: ArchiveTargetFolderRepo
  backgroundJobs: BackgroundJobRepo
  cfHostnames: CfHostnamesProvider
  changelog: ChangelogProvider
  cloudStore: CloudStoreRepo
  cloudTrafficReports: CloudTrafficReportRepo
  downloaders: DownloaderRepo
  downloadTasks: DownloadTaskRepo
  downloadTokens: DownloadTokenGateway
  email: EmailGateway
  invites: InviteRepo
  imageHostingConfigs: ImageHostingConfigRepo
  imageHosting: ImageHostingRepo
  imageUpload: ImageUpload
  instance: InstanceRepo
  licenseBinding: LicenseBindingRepo
  licensingCloud: LicensingCloudGateway
  matter: MatterRepo
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
