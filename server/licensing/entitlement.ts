import type { LicenseFeature } from '@shared/types'
import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import { effectiveFeatures } from '../domain/licensing'
import type { Database } from '../platform/interface'
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
    // The 60s TTL must not outlive the certificate itself: a cert that expires
    // mid-window would otherwise keep granting features until the cache lapses.
    if (!cachedSummary) return null
    const nowSeconds = Math.floor(now / 1000)
    if (nowSeconds < cachedSummary.certificateExpiresAt && nowSeconds < cachedSummary.licenseValidUntil) {
      return cachedSummary
    }
    // Cached cert has since expired — fall through to re-verify (yields null).
  }

  const state = await createLicenseBindingRepo(db).loadLicenseState()
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
