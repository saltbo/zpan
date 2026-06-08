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
  allowIp?: boolean
}

export interface InstanceTelemetryRuntime {
  target: 'cloudflare-worker' | 'node/docker'
  provider: 'cloudflare' | 'node'
  osPlatform?: string
  osArch?: string
  osRelease?: string
  nodeVersion?: string
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
  const disableGeoip = params.config.allowIp === false
  const client = new PostHog(posthogProjectToken, {
    host: posthogHost,
    flushAt: 1,
    flushInterval: 0,
    disableCompression: true,
    disableGeoip,
  })

  await client.captureImmediate({
    distinctId: instanceId,
    event: INSTANCE_TELEMETRY_EVENT,
    disableGeoip,
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
}): Record<string, unknown> {
  const instance = compactObject({
    id: params.instanceId,
    name: params.instanceName,
    url: params.instanceUrl,
    version: packageJson.version,
    runtime: compactObject({
      provider: params.runtime.provider,
      target: params.runtime.target,
    }),
    server: optionalNestedObject({
      os: optionalObject({
        platform: params.runtime.osPlatform,
        arch: params.runtime.osArch,
        release: params.runtime.osRelease,
      }),
    }),
    node: optionalObject({
      version: params.runtime.nodeVersion,
    }),
  })

  const properties: Record<string, unknown> = {
    instance,
    report_trigger: params.trigger,
    report_interval: INSTANCE_TELEMETRY_INTERVAL,
    report_schedule: params.cron,
    reported_at: params.timestamp,
    $set: compactObject({
      instance,
      $current_url: params.instanceUrl,
    }),
    $set_once: compactObject({
      initialInstance: instance,
      initialReportedAt: params.timestamp,
    }),
  }

  addOptionalProperty(properties, '$current_url', params.instanceUrl)

  return properties
}

function addOptionalProperty(properties: Record<string, unknown>, key: string, value: string | undefined): void {
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

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter((entry) => entry[1] !== undefined))
}

function optionalObject(input: Record<string, string | undefined>): Record<string, string> | undefined {
  const output = Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return Object.keys(output).length > 0 ? output : undefined
}

function optionalNestedObject(
  input: Record<string, Record<string, string> | undefined>,
): Record<string, Record<string, string>> | undefined {
  const output = Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, Record<string, string>] => entry[1] !== undefined),
  )
  return Object.keys(output).length > 0 ? output : undefined
}
