import type { PutIhostConfigInput } from '@shared/schemas'
import { nanoid } from 'nanoid'
import { hasFeature } from '../../domain/licensing'
import {
  AppError,
  badRequest,
  conflict,
  featureBlocked,
  type ImageDomainProviderConfig,
  type ImageDomainProviderGateway,
  type ImageDomainProvisioning,
  type ImageHostingConfigRecord,
  type ImageHostingConfigRepo,
  type LicenseBindingRepo,
} from '../ports'
import { loadBindingState } from '../site/licensing'
import { cacheVerifiedImageDomain, invalidateImageDomain } from './domain-cache'

export type ImageHostingConfigDeps = {
  imageHostingConfigs: ImageHostingConfigRepo
  imageDomains: ImageDomainProviderGateway
  licenseBinding: LicenseBindingRepo
  cache?: import('../ports').CacheService
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE constraint failed') || message.includes('unique constraint')
}

function readyProvider(config: ImageDomainProviderConfig | null): config is ImageDomainProviderConfig {
  return Boolean(config?.settings.enabled && config.lastTestedAt && !config.error)
}

async function refreshDomain(
  deps: ImageHostingConfigDeps,
  row: ImageHostingConfigRecord,
  provider: ImageDomainProviderConfig,
): Promise<ImageHostingConfigRecord> {
  if (
    !row.customDomain ||
    row.domainProvider !== provider.settings.provider ||
    provider.settings.provider === 'manual' ||
    row.domainStatus === 'verified'
  ) {
    return row
  }
  const result = await deps.imageDomains.refresh(provider, row.customDomain, row.providerHostnameId)
  const verifiedAt = result.status === 'verified' ? new Date() : null
  await deps.imageHostingConfigs.update(row.orgId, {
    providerHostnameId: result.externalId,
    domainStatus: result.status,
    domainError: result.error,
    domainLastCheckedAt: new Date(),
    domainVerifiedAt: verifiedAt,
  })
  if (verifiedAt) await cacheVerifiedImageDomain(deps, row.customDomain, row.orgId)
  return {
    ...row,
    providerHostnameId: result.externalId,
    domainStatus: result.status,
    domainError: result.error,
    domainLastCheckedAt: new Date(),
    domainVerifiedAt: verifiedAt,
  }
}

export async function getImageHostingConfig(
  deps: ImageHostingConfigDeps,
  orgId: string,
): Promise<ImageHostingConfigRecord | null> {
  return (await getImageHostingConfigView(deps, orgId)).config
}

export async function getImageHostingConfigView(
  deps: ImageHostingConfigDeps,
  orgId: string,
): Promise<{ config: ImageHostingConfigRecord | null; provider: ImageDomainProviderConfig | null }> {
  const row = await deps.imageHostingConfigs.getByOrg(orgId)
  const provider = await deps.imageDomains.getConfig()
  if (!row) return { config: null, provider }
  return {
    config: readyProvider(provider) ? await refreshDomain(deps, row, provider) : row,
    provider,
  }
}

export type PutImageHostingConfigOutcome =
  | { ok: true; config: ImageHostingConfigRecord; provider: ImageDomainProviderConfig | null }
  | { ok: false; error: AppError }

function conflictError() {
  return conflict('Domain already registered by another organization')
}

async function provision(
  deps: ImageHostingConfigDeps,
  provider: ImageDomainProviderConfig,
  domain: string,
): Promise<ImageDomainProvisioning> {
  try {
    return await deps.imageDomains.provision(provider, domain)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('already exists') || message.includes('already been taken') || message.includes('409')) {
      throw conflictError()
    }
    throw error
  }
}

export async function putImageHostingConfig(
  deps: ImageHostingConfigDeps,
  orgId: string,
  body: PutIhostConfigInput,
  appHost: string,
): Promise<PutImageHostingConfigOutcome> {
  const newDomain = body.customDomain?.toLowerCase() ?? null
  if (newDomain && !hasFeature('image_custom_domains', await loadBindingState(deps))) {
    return {
      ok: false,
      error: featureBlocked('Feature not available', {
        metadata: { feature: 'image_custom_domains', upgradeUrl: '/settings/billing' },
      }),
    }
  }
  if (newDomain && newDomain === appHost) {
    return { ok: false, error: badRequest('Custom domain cannot be the application default host') }
  }

  const existing = await deps.imageHostingConfigs.getByOrg(orgId)
  const oldDomain = existing?.customDomain ?? null
  const provider = await deps.imageDomains.getConfig()
  if (newDomain && newDomain !== oldDomain && !readyProvider(provider)) {
    return { ok: false, error: badRequest('Image custom-domain provider is not ready') }
  }

  let binding: ImageDomainProvisioning | null = null
  if (newDomain && newDomain !== oldDomain && provider && readyProvider(provider)) {
    try {
      binding = await provision(deps, provider, newDomain)
    } catch (error) {
      if (error instanceof AppError && error.httpStatus === 409) {
        return { ok: false, error: error as AppError }
      }
      throw error
    }
  }

  if (existing && oldDomain !== newDomain && existing.providerHostnameId) {
    const oldProvider = await deps.imageDomains.getConfig()
    if (oldProvider) await deps.imageDomains.deprovision(oldProvider, existing.providerHostnameId)
  }

  const now = new Date()
  const refererAllowlist =
    body.refererAllowlist !== undefined
      ? body.refererAllowlist
        ? JSON.stringify(body.refererAllowlist)
        : null
      : (existing?.refererAllowlist ?? null)
  const bindingFields = {
    domainProvider: newDomain && provider ? provider.settings.provider : null,
    providerHostnameId:
      binding?.externalId ?? (newDomain === oldDomain ? (existing?.providerHostnameId ?? null) : null),
    domainStatus: binding?.status ?? (newDomain === oldDomain ? (existing?.domainStatus ?? null) : null),
    domainError: binding?.error ?? null,
    verificationToken:
      newDomain && provider?.settings.provider === 'manual'
        ? newDomain === oldDomain
          ? (existing?.verificationToken ?? nanoid(32))
          : nanoid(32)
        : null,
  } as const

  try {
    if (!existing) {
      await deps.imageHostingConfigs.create({
        orgId,
        customDomain: newDomain,
        ...bindingFields,
        refererAllowlist,
      })
    } else {
      await deps.imageHostingConfigs.update(orgId, {
        customDomain: newDomain,
        ...bindingFields,
        domainVerifiedAt: newDomain === oldDomain ? existing.domainVerifiedAt : null,
        domainLastCheckedAt: binding ? now : null,
        refererAllowlist,
      })
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: conflictError() }
    throw error
  }

  await Promise.all([invalidateImageDomain(deps, oldDomain), invalidateImageDomain(deps, newDomain)])
  return {
    ok: true,
    provider,
    config: {
      orgId,
      customDomain: newDomain,
      ...bindingFields,
      domainLastCheckedAt: binding ? now : (existing?.domainLastCheckedAt ?? null),
      domainVerifiedAt: newDomain === oldDomain ? (existing?.domainVerifiedAt ?? null) : null,
      refererAllowlist,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    },
  }
}

export async function deleteImageHostingConfig(deps: ImageHostingConfigDeps, orgId: string): Promise<void> {
  const row = await deps.imageHostingConfigs.getByOrg(orgId)
  if (!row) return
  const provider = await deps.imageDomains.getConfig()
  if (provider && row.providerHostnameId) await deps.imageDomains.deprovision(provider, row.providerHostnameId)
  await deps.imageHostingConfigs.delete(orgId)
  await invalidateImageDomain(deps, row.customDomain)
}
