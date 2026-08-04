import { generateToken } from '@shared/ids'
import type { ImageDomainProviderResponse, ImageDomainSettings, UpdateImageDomainSettingsInput } from '@shared/schemas'
import { cacheVerifiedImageDomain, invalidateImageDomain } from '../image-hosting/domain-cache'
import type {
  ImageDomainProviderConfig,
  ImageDomainProviderGateway,
  ImageHostingConfigRecord,
  ImageHostingConfigRepo,
  SystemOptionsRepo,
} from '../ports'
import { badRequest, IMAGE_DOMAIN_OPTION_KEYS } from '../ports'

export type ImageDomainProviderDeps = {
  imageDomains: ImageDomainProviderGateway
  imageHostingConfigs: ImageHostingConfigRepo
  systemOptions: SystemOptionsRepo
  cache?: import('../ports').CacheService
}

const MASK_PREFIX = '****'

function maskSecret(value: string): string {
  return value ? `${MASK_PREFIX}${value.slice(-4)}` : ''
}

function preserveMaskedSecret(input: string, existing: string | null): string {
  return existing !== null && input === maskSecret(existing) ? existing : input
}

function maskedSettings(config: ImageDomainProviderConfig | null): ImageDomainSettings {
  if (!config) return { enabled: false, provider: null }
  if (config.settings.provider === 'manual') return config.settings
  return {
    ...config.settings,
    cloudflare: {
      ...config.settings.cloudflare,
      apiToken: maskSecret(config.settings.cloudflare.apiToken),
    },
  }
}

export async function getImageDomainProvider(
  deps: Pick<ImageDomainProviderDeps, 'imageDomains' | 'imageHostingConfigs'>,
): Promise<ImageDomainProviderResponse> {
  const [config, rows] = await Promise.all([deps.imageDomains.getConfig(), deps.imageHostingConfigs.listWithDomains()])
  const domains = rows.flatMap((row) =>
    row.customDomain
      ? [
          {
            orgId: row.orgId,
            hostname: row.customDomain,
            provider: row.domainProvider,
            status: row.domainStatus,
            error: row.domainError,
            lastCheckedAt: row.domainLastCheckedAt?.toISOString() ?? null,
          },
        ]
      : [],
  )
  if (!config) {
    return {
      settings: { enabled: false, provider: null },
      status: 'disabled',
      lastTestedAt: null,
      error: null,
      domains,
    }
  }
  const status = !config.settings.enabled
    ? 'disabled'
    : config.error
      ? 'error'
      : config.lastTestedAt
        ? 'ready'
        : 'unverified'
  return {
    settings: maskedSettings(config),
    status,
    lastTestedAt: config.lastTestedAt?.toISOString() ?? null,
    error: config.error,
    domains,
  }
}

function optionEntries(input: UpdateImageDomainSettingsInput, apiToken: string | null) {
  const entries: Array<{ key: string; value: string }> = [
    { key: IMAGE_DOMAIN_OPTION_KEYS.enabled, value: String(input.enabled) },
    { key: IMAGE_DOMAIN_OPTION_KEYS.provider, value: input.provider },
    { key: IMAGE_DOMAIN_OPTION_KEYS.lastTestedAt, value: '' },
    { key: IMAGE_DOMAIN_OPTION_KEYS.error, value: '' },
  ]
  if (input.provider === 'cloudflare_saas') {
    entries.push(
      { key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareApiToken, value: apiToken ?? input.cloudflare.apiToken },
      { key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareZoneId, value: input.cloudflare.zoneId },
      { key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareRoutingMode, value: input.cloudflare.routingMode },
      {
        key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareWorkerName,
        value: input.cloudflare.routingMode === 'worker' ? input.cloudflare.workerName : '',
      },
      {
        key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareOriginHostname,
        value: input.cloudflare.routingMode === 'origin' ? input.cloudflare.originHostname : '',
      },
      { key: IMAGE_DOMAIN_OPTION_KEYS.cloudflareCnameTarget, value: input.cloudflare.cnameTarget },
    )
  } else {
    entries.push({
      key: IMAGE_DOMAIN_OPTION_KEYS.manualRecords,
      value: JSON.stringify(input.manual.records),
    })
  }
  return entries
}

export async function saveImageDomainProvider(
  deps: Pick<ImageDomainProviderDeps, 'imageDomains' | 'imageHostingConfigs' | 'systemOptions' | 'cache'>,
  input: UpdateImageDomainSettingsInput,
): Promise<void> {
  const previous = await deps.imageDomains.getConfig()
  const domains = await deps.imageHostingConfigs.listWithDomains()
  const existingToken = await deps.systemOptions.getValue(IMAGE_DOMAIN_OPTION_KEYS.cloudflareApiToken)
  const apiToken =
    input.provider === 'cloudflare_saas' ? preserveMaskedSecret(input.cloudflare.apiToken, existingToken) : null

  const previousCloudflare = previous?.settings.provider === 'cloudflare_saas' ? previous.settings.cloudflare : null
  const providerDisabled = previous?.settings.enabled === true && !input.enabled
  const cloudflareScopeChanged =
    previousCloudflare !== null &&
    (input.provider !== 'cloudflare_saas' ||
      previousCloudflare.zoneId !== input.cloudflare.zoneId ||
      previousCloudflare.routingMode !== input.cloudflare.routingMode ||
      (previousCloudflare.routingMode === 'worker' &&
        input.cloudflare.routingMode === 'worker' &&
        previousCloudflare.workerName !== input.cloudflare.workerName) ||
      (previousCloudflare.routingMode === 'origin' &&
        input.cloudflare.routingMode === 'origin' &&
        previousCloudflare.originHostname !== input.cloudflare.originHostname))
  const externalBindingsInvalidated = cloudflareScopeChanged || providerDisabled
  if (externalBindingsInvalidated && previous) {
    await Promise.all(
      domains
        .filter((domain) => domain.providerHostnameId)
        .map((domain) => deps.imageDomains.deprovision(previous, domain.providerHostnameId)),
    )
    await deps.imageDomains.teardown(previous)
  }

  await deps.systemOptions.setMany(optionEntries(input, apiToken))
  const preserveExternalIds =
    input.provider === 'cloudflare_saas' &&
    (previous === null ||
      (previous.settings.provider === 'cloudflare_saas' &&
        previous.settings.cloudflare.zoneId === input.cloudflare.zoneId &&
        !externalBindingsInvalidated))
  await deps.imageHostingConfigs.markAllDomainsPending(input.provider, preserveExternalIds)
  await Promise.all(domains.map((domain) => invalidateImageDomain(deps, domain.customDomain)))
}

async function provisionDomain(
  deps: Pick<ImageDomainProviderDeps, 'imageDomains' | 'imageHostingConfigs' | 'cache'>,
  config: ImageDomainProviderConfig,
  row: ImageHostingConfigRecord,
): Promise<void> {
  if (!row.customDomain) return
  const result =
    row.domainProvider === config.settings.provider && row.providerHostnameId
      ? await deps.imageDomains.refresh(config, row.customDomain, row.providerHostnameId)
      : await deps.imageDomains.provision(config, row.customDomain)
  await deps.imageHostingConfigs.update(row.orgId, {
    domainProvider: config.settings.provider,
    providerHostnameId: result.externalId,
    domainStatus: result.status,
    domainError: result.error,
    verificationToken: config.settings.provider === 'manual' ? (row.verificationToken ?? generateToken(33)) : null,
    domainLastCheckedAt: new Date(),
    domainVerifiedAt: result.status === 'verified' ? new Date() : null,
  })
  await invalidateImageDomain(deps, row.customDomain)
}

export async function testImageDomainProvider(deps: ImageDomainProviderDeps): Promise<void> {
  const config = await deps.imageDomains.getConfig()
  if (!config) throw badRequest('Image custom-domain provider is not configured')
  try {
    await deps.imageDomains.test(config.settings)
    const testedAt = new Date()
    await deps.systemOptions.setMany([
      { key: IMAGE_DOMAIN_OPTION_KEYS.lastTestedAt, value: testedAt.toISOString() },
      { key: IMAGE_DOMAIN_OPTION_KEYS.error, value: '' },
    ])
    const readyConfig = { ...config, lastTestedAt: testedAt, error: null }
    if (config.settings.enabled) {
      const domains = await deps.imageHostingConfigs.listWithDomains()
      await Promise.all(domains.map((row) => provisionDomain(deps, readyConfig, row)))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await deps.systemOptions.setMany([
      { key: IMAGE_DOMAIN_OPTION_KEYS.lastTestedAt, value: new Date().toISOString() },
      { key: IMAGE_DOMAIN_OPTION_KEYS.error, value: message },
    ])
    throw badRequest(message)
  }
}

export async function reconcileImageDomains(
  deps: Pick<ImageDomainProviderDeps, 'imageDomains' | 'imageHostingConfigs' | 'cache'>,
): Promise<void> {
  const config = await deps.imageDomains.getConfig()
  if (!config?.settings.enabled || !config.lastTestedAt || config.error || config.settings.provider === 'manual') {
    return
  }
  const domains = await deps.imageHostingConfigs.listWithDomains()
  await Promise.all(
    domains
      .filter(
        (row) => row.customDomain && row.domainProvider === config.settings.provider && row.domainStatus !== 'verified',
      )
      .map(async (row) => {
        try {
          const result = await deps.imageDomains.refresh(config, row.customDomain as string, row.providerHostnameId)
          const checkedAt = new Date()
          await deps.imageHostingConfigs.update(row.orgId, {
            providerHostnameId: result.externalId,
            domainStatus: result.status,
            domainError: result.error,
            domainLastCheckedAt: checkedAt,
            domainVerifiedAt: result.status === 'verified' ? checkedAt : null,
          })
          if (result.status === 'verified') {
            await cacheVerifiedImageDomain(deps, row.customDomain as string, row.orgId)
          }
        } catch (error) {
          await deps.imageHostingConfigs.update(row.orgId, {
            domainStatus: 'failed',
            domainError: error instanceof Error ? error.message : String(error),
            domainLastCheckedAt: new Date(),
            domainVerifiedAt: null,
          })
          await invalidateImageDomain(deps, row.customDomain)
        }
      }),
  )
}
