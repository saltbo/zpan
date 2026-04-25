import type { BindingState, LicenseEntitlement, ProFeature } from '../../shared/types'
import type { Database } from '../platform/interface'
import { loadLicenseState } from './license-state'
import { verifyCertificate } from './verify'

function parseCachedCert(cert: string, instanceId: string): LicenseEntitlement | null {
  if (cert.startsWith('v4.public.')) {
    return verifyCertificate(cert, instanceId)
  }

  try {
    return JSON.parse(cert) as LicenseEntitlement
  } catch {
    return null
  }
}

export async function loadBindingState(db: Database): Promise<BindingState> {
  const state = await loadLicenseState(db)
  if (!state.refreshToken) return { bound: false }

  const result: BindingState = {
    bound: true,
    account_email: state.cloudAccountEmail ?? undefined,
    last_refresh_at: state.lastRefreshAt ?? undefined,
    last_refresh_error: state.lastRefreshError ?? undefined,
  }

  if (state.cachedCert && state.instanceId) {
    const entitlement = parseCachedCert(state.cachedCert, state.instanceId)
    if (entitlement) {
      result.plan = entitlement.plan
      result.features = entitlement.features
      result.expires_at = entitlement.expires_at
        ? Math.floor(new Date(entitlement.expires_at).getTime() / 1000)
        : undefined
    }
  }

  return result
}

export function hasFeature(feature: ProFeature, state: BindingState | null): boolean {
  if (!state?.bound || !state.features) return false
  if (state.expires_at != null && Date.now() > state.expires_at * 1000) return false
  return state.features.includes(feature)
}
