import { PostHog } from 'posthog-node'
import { normalizePublicOrigin, SITE_PUBLIC_ORIGIN_KEY } from '../../domain/site-public-origin'
import type { DeployPlatform } from '../../runtime-platform'
import { getAppVersion } from '../../version'
import type { InstanceRepo, SystemOptionsRepo } from '../ports'

export const INSTANCE_TELEMETRY_CRON = '0 */12 * * *'
export const INSTANCE_TELEMETRY_EVENT = 'heartbeat'
export const INSTANCE_TELEMETRY_INTERVAL = '12h'
export const INSTANCE_TELEMETRY_POSTHOG_HOST = 'https://e.zpan.space'
export const INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN = 'phc_uh9AB5AqnpXpFfW2Ns7bDGHaofSTLcA7TeatP6HzmtpF'

export type InstanceTelemetryDeps = { instance: InstanceRepo; systemOptions: SystemOptionsRepo }

export interface InstanceTelemetryConfig {
  posthogHost?: string
  posthogProjectToken?: string
  siteUrl?: string
  allowIp?: boolean
}

export interface InstanceTelemetryRuntime {
  runtime: 'node' | 'workerd'
  platform: DeployPlatform
  osPlatform?: string
  osArch?: string
  osRelease?: string
  nodeVersion?: string
}

export interface InstanceTelemetryParams {
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

export async function reportInstanceTelemetry(
  deps: InstanceTelemetryDeps,
  params: InstanceTelemetryParams,
): Promise<InstanceTelemetryResult> {
  const posthogHost = (params.config.posthogHost ?? INSTANCE_TELEMETRY_POSTHOG_HOST).trim()
  const posthogProjectToken = (params.config.posthogProjectToken ?? INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN).trim()
  if (!posthogHost || !posthogProjectToken) return { reported: false, reason: 'disabled' }

  const instanceId = await deps.instance.getOrCreateInstanceId()
  const instanceName = await deps.instance.getInstanceDisplayName()
  const instanceUrl = normalizePublicOrigin(params.config.siteUrl) ?? (await resolveSitePublicOrigin(deps)) ?? undefined
  const appVersion = getAppVersion()
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
      appVersion,
      cron: params.cron,
      trigger: params.trigger ?? 'scheduled',
      runtime: params.runtime,
      timestamp,
    }),
  })
  await client.shutdown()

  return { reported: true }
}

async function resolveSitePublicOrigin(deps: InstanceTelemetryDeps): Promise<string | null> {
  return normalizePublicOrigin(await deps.systemOptions.getValue(SITE_PUBLIC_ORIGIN_KEY))
}

function buildTelemetryProperties(params: {
  instanceId: string
  instanceName: string
  instanceUrl?: string
  appVersion: string
  cron: string
  trigger: 'deploy' | 'scheduled' | 'runtime'
  runtime: InstanceTelemetryRuntime
  timestamp: string
}): Record<string, unknown> {
  const instance = compactObject({
    id: params.instanceId,
    name: params.instanceName,
    url: params.instanceUrl,
    version: params.appVersion,
    runtime: params.runtime.runtime,
    platform: params.runtime.platform,
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
