// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  AdminStatsRepo,
  AgentInfoGateway,
  AnnouncementRepo,
  ApiKeyGateway,
  ArchiveTargetFolderRepo,
  AuditActorDirectory,
  AuditRepo,
  BackgroundJobQueue,
  BackgroundJobRepo,
  CacheService,
  ChangelogProvider,
  CloudStoreRepo,
  CloudTrafficReportRepo,
  DownloaderBootstrapCredentialRepo,
  DownloaderRepo,
  DownloadTaskRepo,
  DownloadTokenGateway,
  EmailGateway,
  ImageDomainProviderGateway,
  ImageHostingConfigRepo,
  ImageHostingRepo,
  ImageUpload,
  InstanceRepo,
  InviteRepo,
  LicenseBindingRepo,
  LicensingCloudGateway,
  MatterRepo,
  MediaLibraryRepo,
  MemberCountRepo,
  NotificationRepo,
  OAuthGateway,
  ObjectUploadSessionRepo,
  OrgRepo,
  ProfileRepo,
  QuotaRepo,
  RemoteDownloadUsageRepo,
  ResourceChangeRepo,
  S3Gateway,
  ShareNotificationRepo,
  ShareRepo,
  SiteInvitationRepo,
  StorageRepo,
  StorageUsageBreakdownRepo,
  StorageUsageRepo,
  SystemOptionsRepo,
  TeamInviteRepo,
  TeamRepo,
  TmdbGateway,
  UserAdminRepo,
  WebDavPathRepo,
  WebDavStateRepo,
  X402CapacityPurchaseRepo,
  ZipGateway,
  ZipPlanRepo,
} from './ports'

export interface Deps {
  audit: AuditRepo
  auditActorDirectory: AuditActorDirectory
  agentInfo: AgentInfoGateway
  adminStats: AdminStatsRepo
  oauth: OAuthGateway
  announcements: AnnouncementRepo
  apiKeys: ApiKeyGateway
  archiveTargetFolders: ArchiveTargetFolderRepo
  backgroundJobs: BackgroundJobRepo
  jobQueue: BackgroundJobQueue
  cache: CacheService
  imageDomains: ImageDomainProviderGateway
  changelog: ChangelogProvider
  cloudStore: CloudStoreRepo
  cloudTrafficReports: CloudTrafficReportRepo
  downloaders: DownloaderRepo
  downloaderBootstrapCredentials: DownloaderBootstrapCredentialRepo
  downloadTasks: DownloadTaskRepo
  downloadTokens: DownloadTokenGateway
  email: EmailGateway
  invites: InviteRepo
  imageHostingConfigs: ImageHostingConfigRepo
  imageHosting: ImageHostingRepo
  imageUpload: ImageUpload
  instance: InstanceRepo
  licenseBinding: LicenseBindingRepo
  licenseCloudBaseUrl?: string
  licensingCloud: LicensingCloudGateway
  matter: MatterRepo
  mediaLibraries: MediaLibraryRepo
  memberCount: MemberCountRepo
  notifications: NotificationRepo
  objectUploadSessions: ObjectUploadSessionRepo
  org: OrgRepo
  profiles: ProfileRepo
  quota: QuotaRepo
  remoteDownloadUsage: RemoteDownloadUsageRepo
  resourceChanges: ResourceChangeRepo
  s3: S3Gateway
  shareNotifications: ShareNotificationRepo
  share: ShareRepo
  siteInvitations: SiteInvitationRepo
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  storageUsageBreakdowns: StorageUsageBreakdownRepo
  systemOptions: SystemOptionsRepo
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  tmdb: TmdbGateway
  userAdmin: UserAdminRepo
  webdavPath: WebDavPathRepo
  webdavState: WebDavStateRepo
  zip: ZipGateway
  zipPlan: ZipPlanRepo
  x402CapacityPurchases: X402CapacityPurchaseRepo
}
