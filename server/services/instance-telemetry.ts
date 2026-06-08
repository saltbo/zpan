import { PostHog } from 'posthog-node'
import packageJson from '../../package.json'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import { getInstanceDisplayName } from '../licensing/instance-info'
import type { Database } from '../platform/interface'

export const INSTANCE_TELEMETRY_CRON = '0 */12 * * *'
export const INSTANCE_TELEMETRY_EVENT = 'heartbeat'
export const INSTANCE_TELEMETRY_INTERVAL = '12h'
export const INSTANCE_TELEMETRY_POSTHOG_HOST = 'https://e.zpan.space'
export const INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN = 'phc_uh9AB5AqnpXpFfW2Ns7bDGHaofSTLcA7TeatP6HzmtpF'

export interface InstanceTelemetryConfig {
  posthogHost?: string
  posthogProjectToken?: string
  configuredInstanceId?: string
  siteUrl?: string
}

export interface InstanceTelemetryRuntime {
  target: 'cloudflare-worker' | 'node/docker'
  osPlatform?: string
  osArch?: string
  osRelease?: string
}

export interface InstanceTelemetryParams {
  db: Database
  config: InstanceTelemetryConfig
  cron: string
  trigger?: 'deploy' | 'scheduled' | 'runtime'
  runtime: InstanceTelemetryRuntime
  now?: Date
}

export interface InstanceTelemetryResult {
  reported: boolean
  reason?: 'disabled'
}

export async function reportInstanceTelemetry(params: InstanceTelemetryParams): Promise<InstanceTelemetryResult> {
  const posthogHost = (params.config.posthogHost ?? INSTANCE_TELEMETRY_POSTHOG_HOST).trim()
  const posthogProjectToken = (params.config.posthogProjectToken ?? INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN).trim()
  if (!posthogHost || !posthogProjectToken) return { reported: false, reason: 'disabled' }

  const instanceId = await getOrCreateInstanceId(params.db, params.config.configuredInstanceId)
  const instanceName = await getInstanceDisplayName(params.db)
  const instanceUrl = normalizeSiteUrl(params.config.siteUrl)
  const timestamp = (params.now ?? new Date()).toISOString()
  const client = new PostHog(posthogProjectToken, {
    host: posthogHost,
    flushAt: 1,
    flushInterval: 0,
    disableCompression: true,
  })

  await client.captureImmediate({
    distinctId: instanceId,
    event: INSTANCE_TELEMETRY_EVENT,
    timestamp: new Date(timestamp),
    properties: buildTelemetryProperties({
      instanceId,
      instanceName,
      instanceUrl,
      cron: params.cron,
      trigger: params.trigger ?? 'scheduled',
      runtime: params.runtime,
      timestamp,
    }),
  })
  await client.shutdown()

  return { reported: true }
}

function buildTelemetryProperties(params: {
  instanceId: string
  instanceName: string
  instanceUrl?: string
  cron: string
  trigger: 'deploy' | 'scheduled' | 'runtime'
  runtime: InstanceTelemetryRuntime
  timestamp: string
}): Record<string, string> {
  const properties: Record<string, string> = {
    instance_id: params.instanceId,
    instance_name: params.instanceName,
    instance_version: packageJson.version,
    runtime_target: params.runtime.target,
    report_trigger: params.trigger,
    report_interval: INSTANCE_TELEMETRY_INTERVAL,
    report_schedule: params.cron,
    reported_at: params.timestamp,
  }

  addOptionalProperty(properties, 'instance_url', params.instanceUrl)
  addOptionalProperty(properties, '$current_url', params.instanceUrl)
  addOptionalProperty(properties, 'os_platform', params.runtime.osPlatform)
  addOptionalProperty(properties, 'os_arch', params.runtime.osArch)
  addOptionalProperty(properties, 'os_release', params.runtime.osRelease)

  return properties
}

function addOptionalProperty(properties: Record<string, string>, key: string, value: string | undefined): void {
  if (value) properties[key] = value
}

function normalizeSiteUrl(value: string | undefined): string | undefined {
  const input = value?.trim()
  if (!input) return undefined
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}
