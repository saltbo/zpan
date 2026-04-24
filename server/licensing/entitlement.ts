import { eq } from 'drizzle-orm'
import type { ProFeature } from '@shared/types'
import { licenseBinding } from '../db/schema'
import type { Database } from '../platform/interface'
import { verifyCertificate } from './verify'

export interface EntitlementSummary {
  plan: 'community' | 'pro'
  features: ProFeature[]
}

const CACHE_TTL_MS = 60_000

let cachedSummary: EntitlementSummary | null = null
let cachedAt = 0

// Load and verify the cached license cert from the database.
// Result is memoized in-process for 60 seconds — feature checks never block on DB.
// Cache is automatically invalidated on restart or after TTL.
export async function loadEntitlement(db: Database): Promise<EntitlementSummary | null> {
  const now = Date.now()
  if (cachedAt > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedSummary
  }

  const rows = await db
    .select({ instanceId: licenseBinding.instanceId, cachedCert: licenseBinding.cachedCert })
    .from(licenseBinding)
    .where(eq(licenseBinding.id, 1))
    .limit(1)

  const row = rows[0]
  if (!row?.cachedCert) {
    cachedSummary = null
    cachedAt = now
    return null
  }

  const entitlement = verifyCertificate(row.cachedCert, row.instanceId)
  cachedSummary = entitlement ? { plan: entitlement.plan, features: entitlement.features } : null
  cachedAt = now
  return cachedSummary
}

// Invalidate the in-process cache — call after a cert refresh so the next
// feature check picks up the new entitlement without waiting for TTL.
export function invalidateEntitlementCache(): void {
  cachedAt = 0
  cachedSummary = null
}
