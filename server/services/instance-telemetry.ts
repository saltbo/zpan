import packageJson from '../../package.json'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import type { Database } from '../platform/interface'

export const INSTANCE_TELEMETRY_CRON = '0 */12 * * *'
export const INSTANCE_TELEMETRY_EVENT = 'heartbeat'
export const INSTANCE_TELEMETRY_INTERVAL = '12h'
export const INSTANCE_TELEMETRY_ENDPOINT = 'https://e.zpan.space/v1/events'
export const INSTANCE_TELEMETRY_PRODUCT_TOKEN = 'pub_4709cd351f9bf91df7a4926d8ec835f423b0b2539a1d6f53'

export interface InstanceTelemetryConfig {
  endpoint?: string
  productToken?: string
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
  schema_version: 1
  event: string
  anonymous_id: string
  properties: Record<string, string>
  sent_at: string
}

export async function reportInstanceTelemetry(params: InstanceTelemetryParams): Promise<InstanceTelemetryResult> {
  const endpoint = (params.config.endpoint ?? INSTANCE_TELEMETRY_ENDPOINT).trim()
  const productToken = (params.config.productToken ?? INSTANCE_TELEMETRY_PRODUCT_TOKEN).trim()
  if (!endpoint || !productToken) return { reported: false, reason: 'disabled' }

  const instanceId = await getOrCreateInstanceId(params.db, params.config.configuredInstanceId)
  const timestamp = (params.now ?? new Date()).toISOString()
  const payload = buildTelemetryPayload({
    instanceId,
    cron: params.cron,
    runtime: params.runtime,
    timestamp,
  })

  const res = await (params.fetchFn ?? fetch)(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${productToken}`,
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
    schema_version: 1,
    event: INSTANCE_TELEMETRY_EVENT,
    anonymous_id: params.instanceId,
    properties,
    sent_at: params.timestamp,
  }
}

function addOptionalProperty(properties: Record<string, string>, key: string, value: string | undefined): void {
  if (value) properties[key] = value
}
