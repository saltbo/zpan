import { release as osRelease } from 'node:os'
import { eq } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database, Platform } from '../platform/interface'
import type { CloudInstanceInfo } from '../services/licensing-cloud'
import { getAppVersion } from '../version'
import { getOrCreateInstanceId } from './instance-id'

type RuntimeInfo = Pick<CloudInstanceInfo, 'runtime' | 'server' | 'node'>

export function runtimeInfo(platform: Platform): RuntimeInfo {
  if (platform.getBinding('DB')) {
    return { runtime: { provider: 'cloudflare', target: 'cloudflare-worker' } }
  }
  return {
    runtime: { provider: 'node', target: 'node/docker' },
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

export async function buildCloudInstanceInfo(
  db: Database,
  params: {
    url: string
    runtime?: Pick<CloudInstanceInfo, 'runtime' | 'server' | 'node'>
  },
): Promise<CloudInstanceInfo> {
  const instanceId = await getOrCreateInstanceId(db)
  return {
    id: instanceId,
    name: await getInstanceDisplayName(db),
    url: params.url,
    version: getAppVersion(),
    ...params.runtime,
  }
}
