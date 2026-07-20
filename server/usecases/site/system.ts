import { compareSemver } from '@shared/semver'
import type { InstanceInfo } from '@shared/types'
import { originFromRequestUrl } from '../../domain/site-public-origin'
import { getAppVersion } from '../../version'
import type { ChangelogProvider, InstanceRepo, SystemOptionsRepo } from '../ports'
import { buildInstanceInfo, type runtimeInfo } from './instance-info'
import { getSitePublicOrigin } from './public-origin'

// instance-info keeps RuntimeInfo private; mirror it off the public helper rather
// than reaching into the module. runtimeInfo needs the platform binding, which is
// a request-context value (not a port), so the handler computes it and passes it
// in here.
type RuntimeInfo = ReturnType<typeof runtimeInfo>

export type SystemDeps = {
  systemOptions: SystemOptionsRepo
  instance: InstanceRepo
  changelog: ChangelogProvider
}

// ─── Instance info ───────────────────────────────────────────────────────────

// Resolves the public origin (stored site origin → request-derived → raw request
// origin) and builds the About-page instance info on top of it.
export async function resolveInstanceInfo(
  deps: Pick<SystemDeps, 'systemOptions' | 'instance'>,
  params: { requestUrl: string; runtime: RuntimeInfo },
): Promise<InstanceInfo> {
  const origin =
    (await getSitePublicOrigin(deps)) ?? originFromRequestUrl(params.requestUrl) ?? new URL(params.requestUrl).origin
  return buildInstanceInfo(deps, { url: origin, runtime: params.runtime })
}

// ─── Changelog ───────────────────────────────────────────────────────────────

export type ChangelogResult = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  markdown: string
}

export async function getChangelog(
  deps: Pick<SystemDeps, 'changelog'>,
  params: { now: number; force: boolean },
): Promise<ChangelogResult> {
  const { latestVersion, markdown } = await deps.changelog.fetchChangelog(params.now, { force: params.force })
  const currentVersion = getAppVersion()
  const updateAvailable = latestVersion ? compareSemver(latestVersion, currentVersion) > 0 : false
  return { currentVersion, latestVersion, updateAvailable, markdown }
}
