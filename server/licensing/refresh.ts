import type { Database } from '../platform/interface'
import { CloudNetworkError, CloudUnboundError, refreshEntitlement } from '../services/licensing-cloud'
import { invalidateEntitlementCache } from './entitlement'
import {
  clearLicenseBinding,
  loadLicenseState,
  setLicenseRefreshError,
  updateLicenseBindingAfterRefresh,
} from './license-state'
import { verifyCertificate } from './verify'

const INVALID_CERTIFICATE_ERROR = 'Invalid certificate from cloud'

function normaliseCert(
  raw: string,
  options: { instanceId: string; cloudBaseUrl: string },
): { cert: string; certificateExpiresAt: number | null } {
  const assertion = verifyCertificate(raw, { instanceId: options.instanceId, cloudBaseUrl: options.cloudBaseUrl })
  return { cert: raw, certificateExpiresAt: assertion?.expiresAt ?? null }
}

export async function performRefresh(db: Database, baseUrl: string): Promise<void> {
  const state = await loadLicenseState(db)
  if (!state.refreshToken || !state.instanceId) return

  try {
    const data = await refreshEntitlement(baseUrl, state.refreshToken)
    const { cert, certificateExpiresAt } = normaliseCert(data.certificate, {
      instanceId: state.instanceId,
      cloudBaseUrl: baseUrl,
    })
    if (!certificateExpiresAt) {
      await setLicenseRefreshError(db, state.id, INVALID_CERTIFICATE_ERROR)
      return
    }

    await updateLicenseBindingAfterRefresh(db, {
      id: state.id,
      refreshToken: data.refresh_token,
      cachedCert: cert,
      cachedExpiresAt: certificateExpiresAt,
      cloudAccountEmail: data.account.email,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })

    invalidateEntitlementCache()
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await clearLicenseBinding(db, 'revoked')
      invalidateEntitlementCache()
      return
    }

    if (err instanceof CloudNetworkError || err instanceof Error) {
      await setLicenseRefreshError(db, state.id, err.message)
      return
    }

    throw err
  }
}
