import { PostHog } from 'posthog-node'
import packageJson from '../../package.json'
import { getOrCreateInstanceId } from '../licensing/instance-id'
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
      cron: params.cron,
      runtime: params.runtime,
      timestamp,
    }),
  })
  await client.shutdown()

  return { reported: true }
}

function buildTelemetryProperties(params: {
  instanceId: string
  cron: string
  runtime: InstanceTelemetryRuntime
  timestamp: string
}): Record<string, string> {
  const properties: Record<string, string> = {
    instance_id: params.instanceId,
    app_version: packageJson.version,
    runtime_target: params.runtime.target,
    cron: params.cron,
    report_interval: INSTANCE_TELEMETRY_INTERVAL,
    reported_at: params.timestamp,
  }

  addOptionalProperty(properties, 'os_platform', params.runtime.osPlatform)
  addOptionalProperty(properties, 'os_arch', params.runtime.osArch)
  addOptionalProperty(properties, 'os_release', params.runtime.osRelease)

  return properties
}

function addOptionalProperty(properties: Record<string, string>, key: string, value: string | undefined): void {
  if (value) properties[key] = value
}
