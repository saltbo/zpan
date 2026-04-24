import type { BindingState, LicenseEntitlement, ProFeature } from '../../shared/types'
import { licenseBinding } from '../db/schema'
import type { Database } from '../platform/interface'

export async function loadBindingState(db: Database): Promise<BindingState> {
  const rows = await db.select().from(licenseBinding).limit(1)
  if (rows.length === 0) return { bound: false }

  const row = rows[0]
  const state: BindingState = {
    bound: true,
    account_email: row.cloudAccountEmail ?? undefined,
    last_refresh_at: row.lastRefreshAt ?? undefined,
    last_refresh_error: row.lastRefreshError ?? undefined,
  }

  if (row.cachedCert) {
    try {
      const entitlement = JSON.parse(row.cachedCert) as LicenseEntitlement
      state.plan = entitlement.plan
      state.features = entitlement.features
      state.expires_at = entitlement.expires_at
        ? Math.floor(new Date(entitlement.expires_at).getTime() / 1000)
        : undefined
    } catch {
      // malformed cached cert — treat as unentitled
    }
  }

  return state
}

export function hasFeature(feature: ProFeature, state: BindingState | null): boolean {
  if (!state?.bound || !state.features) return false
  if (state.expires_at != null && Date.now() > state.expires_at * 1000) return false
  return state.features.includes(feature)
}
