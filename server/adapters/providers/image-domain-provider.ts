import type { ImageDomainSettings } from '@shared/schemas'
import type {
  ImageDomainProviderConfig,
  ImageDomainProviderGateway,
  ImageDomainProvisioning,
  SystemOptionsRepo,
} from '../../usecases/ports'
import { IMAGE_DOMAIN_OPTION_KEYS as OPTION_KEYS } from '../../usecases/ports'

type ConfiguredSettings = Exclude<ImageDomainSettings, { provider: null }>

type CloudflareConfig = Extract<ConfiguredSettings, { provider: 'cloudflare_saas' }>['cloudflare']

type CloudflareEnvelope<T> = {
  success: boolean
  errors?: Array<{ code: number; message: string }>
  result: T
}

type CloudflareHostname = {
  id: string
  status: string
  verification_errors?: string[]
  ssl?: {
    status?: string
    validation_errors?: Array<{ message?: string }>
  }
}

type CloudflareZone = {
  name: string
}

type CloudflareDnsRecord = {
  id: string
  type: string
  name: string
  content: string
  proxied: boolean
}

type CloudflareFallbackOrigin = {
  origin?: string
  status?: string
}

type CloudflareRule = {
  id: string
  ref?: string
  expression: string
  action_parameters?: {
    uri?: {
      path?: {
        expression?: string
      }
    }
  }
}

type CloudflareRuleset = {
  id: string
  rules: CloudflareRule[]
}

type CloudflareWorkerRoute = {
  id: string
  pattern: string
  script?: string
}

const IMAGE_PATH_PREFIX = '/ih'
const IMAGE_REWRITE_RULE_REF = 'zpan_image_hosting_rewrite'
const IMAGE_WORKER_ROUTE = `*${IMAGE_PATH_PREFIX}/*`

function cloudflareError(body: CloudflareEnvelope<unknown>, fallback: string): string {
  return (
    body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join('; ') || fallback
  )
}

class CloudflareRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function cloudflareRequest<T>(
  config: CloudflareConfig,
  path: string,
  init?: RequestInit,
): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.zoneId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = (await response.json()) as CloudflareEnvelope<T>
  if (!response.ok || !body.success) {
    throw new CloudflareRequestError(
      cloudflareError(body, `Cloudflare request failed (${response.status})`),
      response.status,
    )
  }
  return body
}

function cloudflareStatus(config: CloudflareConfig, hostname: CloudflareHostname): ImageDomainProvisioning {
  const dnsRecords = [{ type: 'CNAME' as const, value: config.cnameTarget }]
  const sslStatus = hostname.ssl?.status ?? ''
  if (hostname.status === 'active' && sslStatus === 'active') {
    return { externalId: hostname.id, status: 'verified', dnsRecords, error: null }
  }

  const error =
    hostname.verification_errors?.join('; ') ||
    hostname.ssl?.validation_errors
      ?.map((item) => item.message)
      .filter(Boolean)
      .join('; ') ||
    null
  if (hostname.status === 'blocked' || hostname.status === 'moved' || hostname.status === 'deleted') {
    return { externalId: hostname.id, status: 'failed', dnsRecords, error: error ?? hostname.status }
  }
  return {
    externalId: hostname.id,
    status: hostname.status === 'active' ? 'pending_tls' : 'pending_dns',
    dnsRecords,
    error,
  }
}

function parseStoredConfig(values: Map<string, string>): ImageDomainProviderConfig | null {
  const enabled = values.get(OPTION_KEYS.enabled) === 'true'
  const provider = values.get(OPTION_KEYS.provider)
  const lastTestedValue = values.get(OPTION_KEYS.lastTestedAt)
  const base = {
    lastTestedAt: lastTestedValue ? new Date(lastTestedValue) : null,
    error: values.get(OPTION_KEYS.error) || null,
  }

  if (provider === 'cloudflare_saas') {
    const apiToken = values.get(OPTION_KEYS.cloudflareApiToken)
    const zoneId = values.get(OPTION_KEYS.cloudflareZoneId)
    const cnameTarget = values.get(OPTION_KEYS.cloudflareCnameTarget)
    if (!apiToken || !zoneId || !cnameTarget) return null
    const routingMode = values.get(OPTION_KEYS.cloudflareRoutingMode) === 'origin' ? 'origin' : 'worker'
    const routing =
      routingMode === 'origin'
        ? (() => {
            const originHostname = values.get(OPTION_KEYS.cloudflareOriginHostname)
            return originHostname ? { routingMode: 'origin' as const, originHostname } : null
          })()
        : {
            routingMode: 'worker' as const,
            workerName: values.get(OPTION_KEYS.cloudflareWorkerName) || 'zpan',
          }
    if (!routing) return null
    return {
      ...base,
      settings: {
        enabled,
        provider,
        cloudflare: { apiToken, zoneId, cnameTarget, ...routing },
      },
    }
  }

  if (provider === 'manual') {
    const recordsValue = values.get(OPTION_KEYS.manualRecords)
    if (!recordsValue) return null
    return {
      ...base,
      settings: {
        enabled,
        provider,
        manual: { records: JSON.parse(recordsValue) as Array<{ type: 'CNAME' | 'A' | 'AAAA'; value: string }> },
      },
    }
  }

  return null
}

function isHostnameInZone(hostname: string, zoneName: string): boolean {
  return hostname === zoneName || hostname.endsWith(`.${zoneName}`)
}

async function ensureCnameTarget(config: CloudflareConfig, zoneName: string, fallbackOrigin: string | null) {
  const target = config.cnameTarget.toLowerCase()
  if (!isHostnameInZone(target, zoneName)) {
    throw new Error(`Cloudflare CNAME target must be inside the ${zoneName} zone`)
  }

  const records = await cloudflareRequest<CloudflareDnsRecord[]>(
    config,
    `/dns_records?name=${encodeURIComponent(target)}&per_page=100`,
  )
  const existing = records.result[0]
  if (existing) {
    if (!existing.proxied) throw new Error(`Cloudflare DNS record ${target} must be proxied`)
    if (
      fallbackOrigin &&
      target !== fallbackOrigin &&
      (existing.type !== 'CNAME' || existing.content !== fallbackOrigin)
    ) {
      throw new Error(`Cloudflare DNS record ${target} must be a CNAME to ${fallbackOrigin}`)
    }
    return
  }

  await cloudflareRequest<CloudflareDnsRecord>(config, '/dns_records', {
    method: 'POST',
    body: JSON.stringify(
      fallbackOrigin
        ? { type: 'CNAME', name: target, content: fallbackOrigin, proxied: true }
        : { type: 'AAAA', name: target, content: '100::', proxied: true },
    ),
  })
}

async function requireProxiedOrigin(config: CloudflareConfig, zoneName: string, hostname: string): Promise<void> {
  if (!isHostnameInZone(hostname, zoneName)) {
    throw new Error(`Cloudflare origin hostname must be inside the ${zoneName} zone`)
  }
  const records = await cloudflareRequest<CloudflareDnsRecord[]>(
    config,
    `/dns_records?name=${encodeURIComponent(hostname)}&per_page=100`,
  )
  const record = records.result[0]
  if (!record) throw new Error(`Cloudflare origin DNS record ${hostname} does not exist`)
  if (!record.proxied) throw new Error(`Cloudflare origin DNS record ${hostname} must be proxied`)
  if (record.type !== 'A' && record.type !== 'AAAA' && record.type !== 'CNAME') {
    throw new Error(`Cloudflare origin DNS record ${hostname} must be A, AAAA, or CNAME`)
  }
}

async function ensureFallbackOrigin(config: CloudflareConfig, zoneName: string): Promise<void> {
  let fallback: CloudflareFallbackOrigin | null = null
  try {
    fallback = (await cloudflareRequest<CloudflareFallbackOrigin>(config, '/custom_hostnames/fallback_origin')).result
  } catch (error) {
    if (!(error instanceof CloudflareRequestError) || error.status !== 404) throw error
  }

  const activeOrigin = fallback?.status === 'active' && fallback.origin ? fallback.origin.toLowerCase() : null
  await ensureCnameTarget(config, zoneName, activeOrigin)
  if (activeOrigin) return

  const result = await cloudflareRequest<CloudflareFallbackOrigin>(config, '/custom_hostnames/fallback_origin', {
    method: 'PUT',
    body: JSON.stringify({ origin: config.cnameTarget }),
  })
  if (result.result.status !== 'active') {
    throw new Error(
      `Cloudflare fallback origin setup is ${result.result.status ?? 'pending'}; wait a moment and test again`,
    )
  }
}

async function ensureExternalFallbackOrigin(
  config: Extract<CloudflareConfig, { routingMode: 'origin' }>,
  zoneName: string,
): Promise<void> {
  const origin = config.originHostname.toLowerCase()
  await requireProxiedOrigin(config, zoneName, origin)

  let fallback: CloudflareFallbackOrigin | null = null
  try {
    fallback = (await cloudflareRequest<CloudflareFallbackOrigin>(config, '/custom_hostnames/fallback_origin')).result
  } catch (error) {
    if (!(error instanceof CloudflareRequestError) || error.status !== 404) throw error
  }

  if (fallback?.status !== 'active' || fallback.origin?.toLowerCase() !== origin) {
    const result = await cloudflareRequest<CloudflareFallbackOrigin>(config, '/custom_hostnames/fallback_origin', {
      method: 'PUT',
      body: JSON.stringify({ origin }),
    })
    if (result.result.status !== 'active') {
      throw new Error(
        `Cloudflare fallback origin setup is ${result.result.status ?? 'pending'}; wait a moment and test again`,
      )
    }
  }

  await ensureCnameTarget(config, zoneName, origin)
}

function imageRewriteRule(zoneName: string) {
  const escapedZone = zoneName.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return {
    ref: IMAGE_REWRITE_RULE_REF,
    description: 'ZPan image-hosting custom domains',
    expression: `(http.host ne "${escapedZone}" and not ends_with(http.host, ".${escapedZone}") and http.request.uri.path ne "${IMAGE_PATH_PREFIX}" and not starts_with(http.request.uri.path, "${IMAGE_PATH_PREFIX}/"))`,
    action: 'rewrite',
    action_parameters: {
      uri: {
        path: {
          expression: `concat("${IMAGE_PATH_PREFIX}", http.request.uri.path)`,
        },
      },
    },
    enabled: true,
  }
}

async function ensureImageRewriteRule(config: CloudflareConfig, zoneName: string): Promise<void> {
  const path = '/rulesets/phases/http_request_transform/entrypoint'
  const rule = imageRewriteRule(zoneName)
  let ruleset: CloudflareRuleset
  try {
    ruleset = (await cloudflareRequest<CloudflareRuleset>(config, path)).result
  } catch (error) {
    if (!(error instanceof CloudflareRequestError) || error.status !== 404) throw error
    await cloudflareRequest<CloudflareRuleset>(config, '/rulesets', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ZPan image-hosting rewrites',
        description: 'Managed by ZPan',
        kind: 'zone',
        phase: 'http_request_transform',
        rules: [rule],
      }),
    })
    return
  }

  const existing = ruleset.rules.find((candidate) => candidate.ref === IMAGE_REWRITE_RULE_REF)
  if (!existing) {
    await cloudflareRequest<CloudflareRule>(config, `/rulesets/${ruleset.id}/rules`, {
      method: 'POST',
      body: JSON.stringify(rule),
    })
    return
  }
  if (
    existing.expression === rule.expression &&
    existing.action_parameters?.uri?.path?.expression === rule.action_parameters.uri.path.expression
  ) {
    return
  }
  await cloudflareRequest<CloudflareRule>(config, `/rulesets/${ruleset.id}/rules/${existing.id}`, {
    method: 'PATCH',
    body: JSON.stringify(rule),
  })
}

async function removeImageRewriteRule(config: CloudflareConfig): Promise<void> {
  const path = '/rulesets/phases/http_request_transform/entrypoint'
  let ruleset: CloudflareRuleset
  try {
    ruleset = (await cloudflareRequest<CloudflareRuleset>(config, path)).result
  } catch (error) {
    if (error instanceof CloudflareRequestError && error.status === 404) return
    throw error
  }
  const rule = ruleset.rules.find((candidate) => candidate.ref === IMAGE_REWRITE_RULE_REF)
  if (!rule) return
  await cloudflareRequest<unknown>(config, `/rulesets/${ruleset.id}/rules/${rule.id}`, { method: 'DELETE' })
}

async function ensureImageWorkerRoute(config: Extract<CloudflareConfig, { routingMode: 'worker' }>): Promise<void> {
  const routes = await cloudflareRequest<CloudflareWorkerRoute[]>(config, '/workers/routes')
  const existing = routes.result.find((route) => route.pattern === IMAGE_WORKER_ROUTE)
  if (existing?.script === config.workerName) return
  if (existing) {
    throw new Error(
      `Cloudflare Worker route ${IMAGE_WORKER_ROUTE} is already assigned to ${existing.script ?? 'no script'}`,
    )
  }
  await cloudflareRequest<CloudflareWorkerRoute>(config, '/workers/routes', {
    method: 'POST',
    body: JSON.stringify({ pattern: IMAGE_WORKER_ROUTE, script: config.workerName }),
  })
}

async function removeImageWorkerRoute(config: CloudflareConfig): Promise<void> {
  const routes = await cloudflareRequest<CloudflareWorkerRoute[]>(config, '/workers/routes')
  const route = routes.result.find((candidate) => candidate.pattern === IMAGE_WORKER_ROUTE)
  if (!route) return
  await cloudflareRequest<unknown>(config, `/workers/routes/${route.id}`, { method: 'DELETE' })
}

export function createImageDomainProviderGateway(systemOptions: SystemOptionsRepo): ImageDomainProviderGateway {
  return {
    async getConfig() {
      const rows = await systemOptions.listByPrefix('image_domain_')
      return parseStoredConfig(new Map(rows.map((row) => [row.key, row.value])))
    },

    async test(config) {
      if (config.provider === 'manual') return
      const zone = await cloudflareRequest<CloudflareZone>(config.cloudflare, '')
      const cloudflare = { ...config.cloudflare, zoneName: zone.result.name }
      if (cloudflare.routingMode === 'worker') {
        await ensureFallbackOrigin(cloudflare, zone.result.name)
        await ensureImageRewriteRule(cloudflare, zone.result.name)
        await ensureImageWorkerRoute(cloudflare)
      } else {
        await ensureExternalFallbackOrigin(cloudflare, zone.result.name)
      }
      await cloudflareRequest<CloudflareHostname[]>(config.cloudflare, '/custom_hostnames?page=1&per_page=1')
    },

    async teardown(config) {
      if (config.settings.provider !== 'cloudflare_saas' || config.settings.cloudflare.routingMode !== 'worker') return
      await removeImageRewriteRule(config.settings.cloudflare)
      await removeImageWorkerRoute(config.settings.cloudflare)
    },

    async provision(config, hostname) {
      if (config.settings.provider === 'manual') {
        return {
          externalId: null,
          status: 'pending_dns',
          dnsRecords: config.settings.manual.records,
          error: null,
        }
      }
      const body = await cloudflareRequest<CloudflareHostname>(config.settings.cloudflare, '/custom_hostnames', {
        method: 'POST',
        body: JSON.stringify({
          hostname,
          ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
          ...(config.settings.cloudflare.routingMode === 'origin'
            ? { custom_origin_server: config.settings.cloudflare.originHostname }
            : {}),
        }),
      })
      return cloudflareStatus(config.settings.cloudflare, body.result)
    },

    async refresh(config, _hostname, externalId) {
      if (config.settings.provider === 'manual') {
        return {
          externalId: null,
          status: 'pending_dns',
          dnsRecords: config.settings.manual.records,
          error: null,
        }
      }
      if (!externalId) {
        return {
          externalId: null,
          status: 'pending_dns',
          dnsRecords: [{ type: 'CNAME', value: config.settings.cloudflare.cnameTarget }],
          error: null,
        }
      }
      const body = await cloudflareRequest<CloudflareHostname>(
        config.settings.cloudflare,
        `/custom_hostnames/${externalId}`,
      )
      return cloudflareStatus(config.settings.cloudflare, body.result)
    },

    async deprovision(config, externalId) {
      if (config.settings.provider === 'manual' || !externalId) return
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${config.settings.cloudflare.zoneId}/custom_hostnames/${externalId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${config.settings.cloudflare.apiToken}` },
        },
      )
      if (response.status === 404) return
      if (!response.ok) {
        const body = (await response.json()) as CloudflareEnvelope<unknown>
        throw new Error(cloudflareError(body, `Cloudflare delete failed (${response.status})`))
      }
    },
  }
}
