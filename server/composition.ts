// The composition root. createDeps wires concrete adapters into the Deps object
// the rest of the server consumes. This is the ONLY place adapters are
// constructed. Keep it a cheap, request-free factory so the scheduled/queue
// entrypoints can reuse it; request-bound capabilities are passed to usecases as
// function parameters, never stored here.

import { S3Service } from './adapters/gateways/s3'
import { createCfClient } from './adapters/providers/cf-custom-hostnames'
import { createChangelogProvider } from './adapters/providers/changelog'
import { createActivityRepo } from './adapters/repos/activity'
import { createAnnouncementRepo } from './adapters/repos/announcement'
import { createBackgroundJobRepo } from './adapters/repos/background-job'
import { createInstanceRepo } from './adapters/repos/instance'
import { createInviteRepo } from './adapters/repos/invite'
import { createLicenseBindingRepo } from './adapters/repos/license-binding'
import { createNotificationRepo } from './adapters/repos/notification'
import { createOrgRepo } from './adapters/repos/org'
import { createProfileRepo } from './adapters/repos/profile'
import { createQuotaRepo } from './adapters/repos/quota'
import { createSiteInvitationRepo } from './adapters/repos/site-invitations'
import { createStorageRepo } from './adapters/repos/storage'
import { createSystemOptionsRepo } from './adapters/repos/system-options'
import { createTeamRepo } from './adapters/repos/team'
import { createTeamInviteRepo } from './adapters/repos/team-invite'
import { createUserAdminRepo } from './adapters/repos/user-admin'
import type { Platform } from './platform/interface'
import type { Deps } from './usecases/deps'

export function createDeps(platform: Platform): Deps {
  const { db } = platform
  return {
    activity: createActivityRepo(db),
    announcements: createAnnouncementRepo(db),
    backgroundJobs: createBackgroundJobRepo(db),
    cfHostnames: createCfClient((key) => platform.getEnv(key)),
    changelog: createChangelogProvider(),
    invites: createInviteRepo(db),
    instance: createInstanceRepo(db),
    licenseBinding: createLicenseBindingRepo(db),
    notifications: createNotificationRepo(db),
    org: createOrgRepo(db),
    profiles: createProfileRepo(db),
    quota: createQuotaRepo(db),
    s3: new S3Service(),
    siteInvitations: createSiteInvitationRepo(db),
    storages: createStorageRepo(db),
    systemOptions: createSystemOptionsRepo(db),
    teams: createTeamRepo(db),
    teamInvites: createTeamInviteRepo(db),
    userAdmin: createUserAdminRepo(db),
  }
}
