import { createLicenseBindingRepo } from '../adapters/repos/license-binding'
import type { Database } from '../platform/interface'
import {
  type CloudInstanceInfo,
  CloudInvalidResponseError,
  CloudNetworkError,
  CloudUnboundError,
  refreshEntitlement,
} from '../services/licensing-cloud'
import { invalidateEntitlementCache } from './entitlement'
import { verifyCertificate } from './verify'

const INVALID_CERTIFICATE_ERROR = 'Invalid certificate from cloud'
const INVALID_ENTITLEMENT_RESPONSE_ERROR = 'Invalid entitlement response from cloud'

function normaliseCert(
  raw: string,
  options: { instanceId: string; cloudBaseUrl: string },
): { cert: string; certificateExpiresAt: number | null } {
  const assertion = verifyCertificate(raw, { instanceId: options.instanceId, cloudBaseUrl: options.cloudBaseUrl })
  return { cert: raw, certificateExpiresAt: assertion?.expiresAt ?? null }
}

export async function performRefresh(db: Database, baseUrl: string, instance?: CloudInstanceInfo): Promise<void> {
  const state = await createLicenseBindingRepo(db).loadLicenseState()
  if (!state.refreshToken || !state.instanceId) return

  try {
    const data = await refreshEntitlement(baseUrl, state.refreshToken, instance)
    const { cert, certificateExpiresAt } = normaliseCert(data.certificate, {
      instanceId: state.instanceId,
      cloudBaseUrl: baseUrl,
    })
    if (!certificateExpiresAt) {
      await createLicenseBindingRepo(db).setLicenseRefreshError(state.id, INVALID_CERTIFICATE_ERROR)
      return
    }
    if (!data.binding?.storeId || !data.account) {
      await createLicenseBindingRepo(db).setLicenseRefreshError(state.id, INVALID_ENTITLEMENT_RESPONSE_ERROR)
      return
    }

    await createLicenseBindingRepo(db).updateLicenseBindingAfterRefresh({
      id: state.id,
      refreshToken: data.refreshToken,
      cloudStoreId: data.binding.storeId,
      cachedCert: cert,
      cachedExpiresAt: certificateExpiresAt,
      cloudAccountEmail: data.account.email,
      lastRefreshAt: Math.floor(Date.now() / 1000),
    })

    invalidateEntitlementCache()
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await createLicenseBindingRepo(db).clearLicenseBinding('revoked')
      invalidateEntitlementCache()
      return
    }

    if (err instanceof CloudInvalidResponseError || err instanceof CloudNetworkError || err instanceof Error) {
      await createLicenseBindingRepo(db).setLicenseRefreshError(state.id, err.message)
      return
    }

    throw err
  }
}
