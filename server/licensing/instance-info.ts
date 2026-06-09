import { release as osRelease } from 'node:os'
import { eq } from 'drizzle-orm'
import type { InstanceInfo } from '../../shared/types'
import { systemOptions } from '../db/schema'
import type { Database, Platform } from '../platform/interface'
import { getDeployPlatform } from '../runtime-platform'
import type { CloudInstanceInfo } from '../services/licensing-cloud'
import { getAppCommit, getAppVersion } from '../version'
import { getOrCreateInstanceId } from './instance-id'

type RuntimeInfo = Pick<InstanceInfo, 'runtime' | 'platform' | 'server' | 'node'>

export function runtimeInfo(platform: Platform): RuntimeInfo {
  if (platform.getBinding('DB')) {
    return { runtime: 'workerd', platform: 'cloudflare-workers' }
  }
  return {
    runtime: 'node',
    platform: getDeployPlatform() ?? 'node',
    server: { os: { platform: process.platform, arch: process.arch, release: osRelease() } },
    node: { version: process.version },
  }
}

export async function getInstanceDisplayName(db: Database): Promise<string> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'site_title'))
    .limit(1)

  return rows[0]?.value ?? 'ZPan'
}

// Shown on the admin About page: flat runtime engine + deployment platform.
export async function buildInstanceInfo(
  db: Database,
  params: { url: string; runtime?: RuntimeInfo },
): Promise<InstanceInfo> {
  return {
    id: await getOrCreateInstanceId(db),
    name: await getInstanceDisplayName(db),
    url: params.url,
    version: getAppVersion(),
    commit: getAppCommit(),
    ...params.runtime,
  }
}

// Reported to ZPan Cloud. The cloud SDK fixes the coarse `runtime { provider,
// target }` shape, so collapse the richer platform back to it here.
function toCloudRuntime(info?: RuntimeInfo): Pick<CloudInstanceInfo, 'runtime' | 'server' | 'node'> {
  if (!info?.runtime) return {}
  const cloudflare = info.runtime === 'workerd'
  return {
    runtime: {
      provider: cloudflare ? 'cloudflare' : 'node',
      target: cloudflare ? 'cloudflare-worker' : 'node/docker',
    },
    server: info.server,
    node: info.node,
  }
}

export async function buildCloudInstanceInfo(
  db: Database,
  params: { url: string; runtime?: RuntimeInfo },
): Promise<CloudInstanceInfo> {
  return {
    id: await getOrCreateInstanceId(db),
    name: await getInstanceDisplayName(db),
    url: params.url,
    version: getAppVersion(),
    commit: getAppCommit(),
    ...toCloudRuntime(params.runtime),
  }
}
