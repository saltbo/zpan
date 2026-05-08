import type { CloudOrderQuotaChange } from '@shared/schemas'
import { eq, sql } from 'drizzle-orm'
import { orgQuotas } from '../db/schema'
import type { Database } from '../platform/interface'

export async function ensureTargetQuota(db: Database, orgId: string): Promise<void> {
  const rows = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1)
  if (rows.length === 0) throw new Error('target_quota_missing')
}

export function ensureTargetQuotaSync(db: Database, orgId: string): void {
  const rows = (
    db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId)).limit(1) as {
      all(): Array<{ id: string }>
    }
  ).all()
  if (rows.length === 0) throw new Error('target_quota_missing')
}

export function trafficQuotaUpdateValues(direction: CloudOrderQuotaChange['direction'], bytes: number) {
  if (direction === 'increase') return { trafficQuota: sql`${orgQuotas.trafficQuota} + ${bytes}` }
  return { trafficQuota: sql`MAX(0, ${orgQuotas.trafficQuota} - ${bytes})` }
}

export function storageQuotaDecreaseValues(bytes: number) {
  return { quota: sql`MAX(0, ${orgQuotas.quota} - ${bytes})` }
}
