import type { LicenseEntitlement } from '@shared/types'
import { eq } from 'drizzle-orm'
import { licenseBinding } from '../db/schema'
import type { Database } from '../platform/interface'
import { CloudNetworkError, CloudUnboundError, refreshEntitlement } from '../services/licensing-cloud'
import { invalidateEntitlementCache } from './entitlement'
import { verifyCertificate } from './verify'

// Normalise the entitlement from cloud into a stored JSON string.
// Cloud C5 will always return a PASETO-signed string; before C5 it may be an
// object. In the pre-C5 path we store the raw JSON. In the PASETO path we verify
// the cert and store the raw token so it can be re-verified on subsequent reads.
function normaliseCert(
  raw: string | object,
  instanceId: string,
): { cert: string; entitlement: LicenseEntitlement | null } {
  if (typeof raw === 'string') {
    // PASETO string — verify and cache the raw token
    const entitlement = verifyCertificate(raw, instanceId)
    return { cert: raw, entitlement }
  }

  // Pre-C5 plain object — store as JSON; treat as trusted (no sig check yet)
  // TODO: assert PASETO string once C5 lands; remove this branch
  const cert = JSON.stringify(raw)
  const typed = raw as LicenseEntitlement
  return { cert, entitlement: typed }
}

// Performs an entitlement refresh against cloud using the stored refresh_token.
//
// On success: rotates refresh_token + cached_cert, updates last_refresh_at, clears last_refresh_error.
// On CloudUnboundError (401): clears the licenseBinding row entirely (instance unbound from cloud).
// On network error: updates last_refresh_error only — keeps existing cached cert intact.
export async function performRefresh(db: Database, baseUrl: string): Promise<void> {
  const rows = await db
    .select({
      instanceId: licenseBinding.instanceId,
      refreshToken: licenseBinding.refreshToken,
    })
    .from(licenseBinding)
    .where(eq(licenseBinding.id, 1))
    .limit(1)

  const row = rows[0]
  if (!row) return // no binding — nothing to refresh

  try {
    const data = await refreshEntitlement(baseUrl, row.refreshToken)
    const { cert, entitlement } = normaliseCert(data.entitlement, row.instanceId)

    await db
      .update(licenseBinding)
      .set({
        refreshToken: data.refresh_token,
        cachedCert: cert,
        cachedExpiresAt: entitlement ? Math.floor(new Date(entitlement.expires_at).getTime() / 1000) : null,
        lastRefreshAt: Math.floor(Date.now() / 1000),
        lastRefreshError: null,
      })
      .where(eq(licenseBinding.id, 1))

    invalidateEntitlementCache()
  } catch (err) {
    if (err instanceof CloudUnboundError) {
      await db.delete(licenseBinding).where(eq(licenseBinding.id, 1))
      invalidateEntitlementCache()
      return
    }

    if (err instanceof CloudNetworkError || err instanceof Error) {
      await db.update(licenseBinding).set({ lastRefreshError: err.message }).where(eq(licenseBinding.id, 1))
      // Keep cached cert — it remains valid until its own expires_at
      return
    }

    throw err
  }
}
