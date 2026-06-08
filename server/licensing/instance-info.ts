import { eq } from 'drizzle-orm'
import packageJson from '../../package.json'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'
import type { CloudInstanceInfo } from '../services/licensing-cloud'
import { getOrCreateInstanceId } from './instance-id'

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
    configuredInstanceId?: string
  },
): Promise<CloudInstanceInfo> {
  const instanceId = await getOrCreateInstanceId(db, params.configuredInstanceId)
  return {
    id: instanceId,
    name: await getInstanceDisplayName(db),
    url: params.url,
    version: packageJson.version,
  }
}
