import type { ImageDomainDnsRecord, ImageDomainSettings } from '@shared/schemas'

export const IMAGE_DOMAIN_OPTION_KEYS = {
  enabled: 'image_domain_enabled',
  provider: 'image_domain_provider',
  cloudflareApiToken: 'image_domain_cloudflare_api_token',
  cloudflareZoneId: 'image_domain_cloudflare_zone_id',
  cloudflareCnameTarget: 'image_domain_cloudflare_cname_target',
  manualRecords: 'image_domain_manual_records',
  lastTestedAt: 'image_domain_last_tested_at',
  error: 'image_domain_error',
} as const

export type ImageDomainProvider = Exclude<ImageDomainSettings['provider'], null>
export type ImageDomainBindingStatus = 'pending_dns' | 'pending_tls' | 'verified' | 'failed'

export interface ImageDomainProviderConfig {
  settings: Exclude<ImageDomainSettings, { provider: null }>
  lastTestedAt: Date | null
  error: string | null
}

export interface ImageDomainProvisioning {
  externalId: string | null
  status: ImageDomainBindingStatus
  dnsRecords: ImageDomainDnsRecord[]
  error: string | null
}

export interface ImageDomainProviderGateway {
  getConfig(): Promise<ImageDomainProviderConfig | null>
  test(config: Exclude<ImageDomainSettings, { provider: null }>): Promise<void>
  provision(config: ImageDomainProviderConfig, hostname: string): Promise<ImageDomainProvisioning>
  refresh(
    config: ImageDomainProviderConfig,
    hostname: string,
    externalId: string | null,
  ): Promise<ImageDomainProvisioning>
  deprovision(config: ImageDomainProviderConfig, externalId: string | null): Promise<void>
}
