import packageJson from '../../package.json'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import type { Database } from '../platform/interface'

export const INSTANCE_TELEMETRY_CRON = '0 */12 * * *'
export const INSTANCE_TELEMETRY_EVENT = 'zpan instance reported'
export const INSTANCE_TELEMETRY_INTERVAL = '12h'

export interface InstanceTelemetryConfig {
  posthogHost?: string
  posthogProjectToken?: string
  configuredInstanceId?: string
}

export interface InstanceTelemetryRuntime {
  target: 'cloudflare-worker' | 'node/docker'
  hostname?: string
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
  fetchFn?: typeof fetch
}

export interface InstanceTelemetryResult {
  reported: boolean
  reason?: 'disabled'
}

interface PostHogCapturePayload {
  api_key: string
  event: string
  distinct_id: string
  properties: Record<string, string>
  timestamp: string
}

export async function reportInstanceTelemetry(params: InstanceTelemetryParams): Promise<InstanceTelemetryResult> {
  const posthogHost = params.config.posthogHost?.trim()
  const posthogProjectToken = params.config.posthogProjectToken?.trim()
  if (!posthogHost || !posthogProjectToken) return { reported: false, reason: 'disabled' }

  const instanceId = await getOrCreateInstanceId(params.db, params.config.configuredInstanceId)
  const timestamp = (params.now ?? new Date()).toISOString()
  const payload = buildPostHogCapturePayload({
    instanceId,
    posthogProjectToken,
    cron: params.cron,
    runtime: params.runtime,
    timestamp,
  })

  const res = await (params.fetchFn ?? fetch)(posthogCaptureUrl(posthogHost), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error(`posthog_capture_failed_${res.status}`)
  return { reported: true }
}

function buildPostHogCapturePayload(params: {
  instanceId: string
  posthogProjectToken: string
  cron: string
  runtime: InstanceTelemetryRuntime
  timestamp: string
}): PostHogCapturePayload {
  const properties: Record<string, string> = {
    instance_id: params.instanceId,
    app_version: packageJson.version,
    runtime_target: params.runtime.target,
    cron: params.cron,
    report_interval: INSTANCE_TELEMETRY_INTERVAL,
    reported_at: params.timestamp,
  }

  addOptionalProperty(properties, 'hostname', params.runtime.hostname)
  addOptionalProperty(properties, 'os_platform', params.runtime.osPlatform)
  addOptionalProperty(properties, 'os_arch', params.runtime.osArch)
  addOptionalProperty(properties, 'os_release', params.runtime.osRelease)

  return {
    api_key: params.posthogProjectToken,
    event: INSTANCE_TELEMETRY_EVENT,
    distinct_id: params.instanceId,
    properties,
    timestamp: params.timestamp,
  }
}

function addOptionalProperty(properties: Record<string, string>, key: string, value: string | undefined): void {
  if (value) properties[key] = value
}

function posthogCaptureUrl(host: string): string {
  return `${host.replace(/\/+$/, '')}/capture/`
}
