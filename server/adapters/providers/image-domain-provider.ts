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

function cloudflareError(body: CloudflareEnvelope<unknown>, fallback: string): string {
  return (
    body.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join('; ') || fallback
  )
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
    throw new Error(cloudflareError(body, `Cloudflare request failed (${response.status})`))
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
    return {
      ...base,
      settings: {
        enabled,
        provider,
        cloudflare: { apiToken, zoneId, cnameTarget },
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

export function createImageDomainProviderGateway(systemOptions: SystemOptionsRepo): ImageDomainProviderGateway {
  return {
    async getConfig() {
      const rows = await systemOptions.listByPrefix('image_domain_')
      return parseStoredConfig(new Map(rows.map((row) => [row.key, row.value])))
    },

    async test(config) {
      if (config.provider === 'manual') return
      await cloudflareRequest<unknown>(config.cloudflare, '')
      const fallback = await cloudflareRequest<{ status?: string }>(
        config.cloudflare,
        '/custom_hostnames/fallback_origin',
      )
      if (fallback.result.status !== 'active') {
        throw new Error(`Cloudflare fallback origin is ${fallback.result.status ?? 'not configured'}`)
      }
      await cloudflareRequest<CloudflareHostname[]>(config.cloudflare, '/custom_hostnames?page=1&per_page=1')
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
