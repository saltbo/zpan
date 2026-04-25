import type { ProFeature } from '@shared/types'
import type { Database } from '../platform/interface'
import { loadLicenseState } from './license-state'
import { verifyCertificate } from './verify'

export interface EntitlementSummary {
  plan: 'community' | 'pro'
  features: ProFeature[]
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

  const entitlement = verifyCertificate(state.cachedCert, state.instanceId)
  cachedSummary = entitlement ? { plan: entitlement.plan, features: entitlement.features } : null
  cachedAt = now
  return cachedSummary
}

export function invalidateEntitlementCache(): void {
  cachedAt = 0
  cachedSummary = null
}
