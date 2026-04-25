import type { LicenseEntitlement } from '@shared/types'
import type { Database } from '../platform/interface'
import { CloudNetworkError, CloudUnboundError, refreshEntitlement } from '../services/licensing-cloud'
import { invalidateEntitlementCache } from './entitlement'
import { clearLicenseBinding, LICENSE_KEYS, loadLicenseState, setLicenseOptions } from './license-state'
import { verifyCertificate } from './verify'

function normaliseCert(raw: string, instanceId: string): { cert: string; entitlement: LicenseEntitlement | null } {
  const entitlement = verifyCertificate(raw, instanceId)
  return { cert: raw, entitlement }
}

export async function performRefresh(db: Database, baseUrl: string): Promise<void> {
  const state = await loadLicenseState(db)
  if (!state.refreshToken || !state.instanceId) return

  try {
    const data = await refreshEntitlement(baseUrl, state.refreshToken)
    const { cert, entitlement } = normaliseCert(data.certificate, state.instanceId)

    await setLicenseOptions(db, {
      [LICENSE_KEYS.refreshToken]: data.refresh_token,
      [LICENSE_KEYS.cachedCert]: cert,
      [LICENSE_KEYS.cachedExpiresAt]: entitlement
        ? String(Math.floor(new Date(entitlement.expires_at).getTime() / 1000))
        : null,
      [LICENSE_KEYS.lastRefreshAt]: String(Math.floor(Date.now() / 1000)),
      [LICENSE_KEYS.lastRefreshError]: null,
    })

    invalidateEntitlementCache()
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await clearLicenseBinding(db)
      invalidateEntitlementCache()
      return
    }

    if (err instanceof CloudNetworkError || err instanceof Error) {
      await setLicenseOptions(db, {
        [LICENSE_KEYS.lastRefreshError]: err.message,
      })
      return
    }

    throw err
  }
}
