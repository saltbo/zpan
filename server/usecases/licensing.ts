import type { BindingState } from '@shared/types'
import { effectiveFeatures } from '../domain/licensing'
import { verifyCertificate } from './license-certificate'
import type { LicenseBindingRepo } from './ports'

export interface BindingStateOptions {
  currentHost?: string | null
  cloudBaseUrl?: string | null
}

// Reads the active license binding and derives the runtime BindingState by
// verifying the cached certificate. Orchestration: repo read + pure verify.
export async function loadBindingState(
  deps: { licenseBinding: LicenseBindingRepo },
  options: BindingStateOptions = {},
): Promise<BindingState> {
  const state = await deps.licenseBinding.loadLicenseState()
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
      result.features = effectiveFeatures(assertion.edition)
      result.license_id = assertion.licenseId
      result.license_valid_until = assertion.licenseValidUntil
      result.certificate_expires_at = assertion.expiresAt
    }
  }

  return result
}
