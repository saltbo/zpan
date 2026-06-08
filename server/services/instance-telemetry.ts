import packageJson from '../../package.json'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import type { Database } from '../platform/interface'

export const INSTANCE_TELEMETRY_CRON = '0 */12 * * *'
export const INSTANCE_TELEMETRY_EVENT = 'heartbeat'
export const INSTANCE_TELEMETRY_INTERVAL = '12h'
export const INSTANCE_TELEMETRY_ENDPOINT = 'https://e.zpan.space/capture/'
export const INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN = 'pub_4709cd351f9bf91df7a4926d8ec835f423b0b2539a1d6f53'

export interface InstanceTelemetryConfig {
  endpoint?: string
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
  fetchFn?: typeof fetch
}

export interface InstanceTelemetryResult {
  reported: boolean
  reason?: 'disabled'
}

interface TelemetryCapturePayload {
  api_key: string
  event: string
  distinct_id: string
  properties: Record<string, string>
  timestamp: string
}

export async function reportInstanceTelemetry(params: InstanceTelemetryParams): Promise<InstanceTelemetryResult> {
  const endpoint = (params.config.endpoint ?? INSTANCE_TELEMETRY_ENDPOINT).trim()
  const posthogProjectToken = (params.config.posthogProjectToken ?? INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN).trim()
  if (!endpoint || !posthogProjectToken) return { reported: false, reason: 'disabled' }

  const instanceId = await getOrCreateInstanceId(params.db, params.config.configuredInstanceId)
  const timestamp = (params.now ?? new Date()).toISOString()
  const payload = buildTelemetryPayload({
    instanceId,
    cron: params.cron,
    runtime: params.runtime,
    timestamp,
    posthogProjectToken,
  })

  const res = await (params.fetchFn ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error(`instance_telemetry_failed_${res.status}`)
  return { reported: true }
}

function buildTelemetryPayload(params: {
  instanceId: string
  cron: string
  runtime: InstanceTelemetryRuntime
  timestamp: string
  posthogProjectToken: string
}): TelemetryCapturePayload {
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
