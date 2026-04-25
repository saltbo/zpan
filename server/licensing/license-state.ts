import { eq, inArray } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

// License state stored as system_options keys instead of a dedicated table
const LICENSE_KEYS = {
  instanceId: 'license_instance_id',
  refreshToken: 'license_refresh_token',
  cachedCert: 'license_cached_cert',
  cachedExpiresAt: 'license_cached_expires_at',
  lastRefreshAt: 'license_last_refresh_at',
  lastRefreshError: 'license_last_refresh_error',
  boundAt: 'license_bound_at',
  cloudAccountEmail: 'license_cloud_account_email',
} as const

const ALL_LICENSE_KEYS = Object.values(LICENSE_KEYS)

export interface LicenseState {
  instanceId: string | null
  refreshToken: string | null
  cachedCert: string | null
  cachedExpiresAt: number | null
  lastRefreshAt: number | null
  lastRefreshError: string | null
  boundAt: number | null
  cloudAccountEmail: string | null
}

export async function loadLicenseState(db: Database): Promise<LicenseState> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(inArray(systemOptions.key, ALL_LICENSE_KEYS))

  const map = new Map(rows.map((r) => [r.key, r.value]))

  return {
    instanceId: map.get(LICENSE_KEYS.instanceId) ?? null,
    refreshToken: map.get(LICENSE_KEYS.refreshToken) ?? null,
    cachedCert: map.get(LICENSE_KEYS.cachedCert) ?? null,
    cachedExpiresAt: toNumber(map.get(LICENSE_KEYS.cachedExpiresAt)),
    lastRefreshAt: toNumber(map.get(LICENSE_KEYS.lastRefreshAt)),
    lastRefreshError: map.get(LICENSE_KEYS.lastRefreshError) ?? null,
    boundAt: toNumber(map.get(LICENSE_KEYS.boundAt)),
    cloudAccountEmail: map.get(LICENSE_KEYS.cloudAccountEmail) ?? null,
  }
}

export async function setLicenseOption(db: Database, key: string, value: string): Promise<void> {
  await db
    .insert(systemOptions)
    .values({ key, value, public: false })
    .onConflictDoUpdate({ target: systemOptions.key, set: { value } })
}

export async function setLicenseOptions(db: Database, entries: Record<string, string | null>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) {
      await db.delete(systemOptions).where(eq(systemOptions.key, key))
    } else {
      await setLicenseOption(db, key, value)
    }
  }
}

export async function clearLicenseBinding(db: Database): Promise<void> {
  await db.delete(systemOptions).where(inArray(systemOptions.key, ALL_LICENSE_KEYS))
}

export { LICENSE_KEYS }

function toNumber(val: string | undefined): number | null {
  if (val == null) return null
  const n = Number(val)
  return Number.isNaN(n) ? null : n
}
