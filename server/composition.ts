// The composition root. createDeps wires concrete adapters into the Deps object
// the rest of the server consumes. This is the ONLY place adapters are
// constructed. Keep it a cheap, request-free factory so the scheduled/queue
// entrypoints can reuse it; request-bound capabilities are passed to usecases as
// function parameters, never stored here.

import { createArchiveJobsGateway } from './adapters/gateways/archive-jobs'
import { createEmailGateway } from './adapters/gateways/email'
import { createImageUploadGateway } from './adapters/gateways/image-upload'
import { createLicensingCloudGateway } from './adapters/gateways/licensing-cloud'
import { S3Service } from './adapters/gateways/s3'
import { createZipGateway } from './adapters/gateways/zip'
import { createCfClient } from './adapters/providers/cf-custom-hostnames'
import { createChangelogProvider } from './adapters/providers/changelog'
import { createActivityRepo } from './adapters/repos/activity'
import { createAnnouncementRepo } from './adapters/repos/announcement'
import { createApiKeyGateway } from './adapters/repos/api-keys'
import { createArchiveTargetFolderRepo } from './adapters/repos/archive-target-folder'
import { createBackgroundJobRepo } from './adapters/repos/background-job'
import { createCloudStoreRepo } from './adapters/repos/cloud-store'
import { createCloudTrafficReportRepo } from './adapters/repos/cloud-traffic-report'
import { createDownloadTokenGateway } from './adapters/repos/download-tokens'
import { createImageHostingRepo } from './adapters/repos/image-hosting'
import { createImageHostingConfigRepo } from './adapters/repos/image-hosting-config'
import { createInstanceRepo } from './adapters/repos/instance'
import { createInviteRepo } from './adapters/repos/invite'
import { createLicenseBindingRepo } from './adapters/repos/license-binding'
import { createMemberCountRepo } from './adapters/repos/member-count'
import { createNotificationRepo } from './adapters/repos/notification'
import { createObjectUploadSessionRepo } from './adapters/repos/object-upload-session'
import { createOrgRepo } from './adapters/repos/org'
import { createProfileRepo } from './adapters/repos/profile'
import { createQuotaRepo } from './adapters/repos/quota'
import { createRemoteDownloadUsageRepo } from './adapters/repos/remote-download-usage'
import { createShareRepo } from './adapters/repos/share'
import { createShareNotificationRepo } from './adapters/repos/share-notification'
import { createSiteInvitationRepo } from './adapters/repos/site-invitations'
import { createStorageRepo } from './adapters/repos/storage'
import { createStorageUsageRepo } from './adapters/repos/storage-usage'
import { createSystemOptionsRepo } from './adapters/repos/system-options'
import { createTeamRepo } from './adapters/repos/team'
import { createTeamInviteRepo } from './adapters/repos/team-invite'
import { createUserAdminRepo } from './adapters/repos/user-admin'
import { createWebDavPathRepo } from './adapters/repos/webdav-path'
import { createWebDavStateRepo } from './adapters/repos/webdav-state'
import { createZipPlanRepo } from './adapters/repos/zip'
import type { Platform } from './platform/interface'
import type { Deps } from './usecases/deps'

export function createDeps(platform: Platform): Deps {
  const { db } = platform
  return {
    activity: createActivityRepo(db),
    announcements: createAnnouncementRepo(db),
    apiKeys: createApiKeyGateway(),
    archiveJobs: createArchiveJobsGateway(platform),
    archiveTargetFolders: createArchiveTargetFolderRepo(db),
    backgroundJobs: createBackgroundJobRepo(db),
    cfHostnames: createCfClient((key) => platform.getEnv(key)),
    changelog: createChangelogProvider(),
    cloudStore: createCloudStoreRepo(db),
    cloudTrafficReports: createCloudTrafficReportRepo(db),
    downloadTokens: createDownloadTokenGateway(),
    email: createEmailGateway(createSystemOptionsRepo(db)),
    invites: createInviteRepo(db),
    imageHostingConfigs: createImageHostingConfigRepo(db),
    imageHosting: createImageHostingRepo(db),
    imageUpload: createImageUploadGateway(new S3Service(), createStorageRepo(db)),
    instance: createInstanceRepo(db),
    licenseBinding: createLicenseBindingRepo(db),
    licensingCloud: createLicensingCloudGateway(),
    memberCount: createMemberCountRepo(db),
    notifications: createNotificationRepo(db),
    objectUploadSessions: createObjectUploadSessionRepo(db),
    org: createOrgRepo(db),
    profiles: createProfileRepo(db),
    quota: createQuotaRepo(db),
    remoteDownloadUsage: createRemoteDownloadUsageRepo(db),
    s3: new S3Service(),
    shareNotifications: createShareNotificationRepo(db),
    share: createShareRepo(db),
    siteInvitations: createSiteInvitationRepo(db),
    storages: createStorageRepo(db),
    storageUsage: createStorageUsageRepo(db),
    systemOptions: createSystemOptionsRepo(db),
    teams: createTeamRepo(db),
    teamInvites: createTeamInviteRepo(db),
    userAdmin: createUserAdminRepo(db),
    webdavPath: createWebDavPathRepo(db),
    webdavState: createWebDavStateRepo(db),
    zip: createZipGateway(),
    zipPlan: createZipPlanRepo(db),
  }
}
