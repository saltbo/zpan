import type { BindingState, ProFeature } from '../../shared/types'
import type { Database } from '../platform/interface'
import { loadLicenseState } from './license-state'
import { verifyCertificate } from './verify'

export interface BindingStateOptions {
  currentHost?: string | null
  cloudBaseUrl?: string | null
}

export async function loadBindingState(db: Database, options: BindingStateOptions = {}): Promise<BindingState> {
  const state = await loadLicenseState(db)
  if (!state.refreshToken) return { bound: false }

  const result: BindingState = {
    bound: true,
    active: false,
    account_email: state.cloudAccountEmail ?? undefined,
    last_refresh_at: state.lastRefreshAt ?? undefined,
    last_refresh_error: state.lastRefreshError ?? undefined,
  }

  if (state.cachedCert && state.instanceId) {
    const assertion = verifyCertificate(state.cachedCert, {
      instanceId: state.instanceId,
      currentHost: options.currentHost,
      cloudBaseUrl: options.cloudBaseUrl,
    })
    if (assertion) {
      result.active = true
      result.edition = assertion.edition
      result.license_valid_until = assertion.licenseValidUntil
      result.certificate_expires_at = assertion.expiresAt
    }
  }

  return result
}

export function hasFeature(feature: ProFeature, state: BindingState | null): boolean {
  return Boolean(feature && state?.bound && state.active)
}
