import type { LicenseFeature } from '@shared/types'
import type { Database } from '../platform/interface'
import { effectiveFeatures } from './has-feature'
import { loadLicenseState } from './license-state'
import { verifyCertificate } from './verify'

export interface EntitlementSummary {
  edition: 'pro' | 'business'
  features: LicenseFeature[]
  licenseId?: string
  certificateExpiresAt: number
  licenseValidUntil: number
}

const CACHE_TTL_MS = 60_000

let cachedSummary: EntitlementSummary | null = null
let cachedAt = 0

export async function loadEntitlement(db: Database): Promise<EntitlementSummary | null> {
  const now = Date.now()
  if (cachedAt > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedSummary
  }

  const state = await loadLicenseState(db)
  if (!state.cachedCert || !state.instanceId) {
    cachedSummary = null
    cachedAt = now
    return null
  }

  const assertion = verifyCertificate(state.cachedCert, { instanceId: state.instanceId })
  cachedSummary = assertion
    ? {
        edition: assertion.edition,
        features: effectiveFeatures(assertion.edition),
        licenseId: assertion.licenseId,
        certificateExpiresAt: assertion.expiresAt,
        licenseValidUntil: assertion.licenseValidUntil,
      }
    : null
  cachedAt = now
  return cachedSummary
}

export function invalidateEntitlementCache(): void {
  cachedAt = 0
  cachedSummary = null
}
