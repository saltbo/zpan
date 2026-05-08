import type { CloudOrderQuotaChange } from '@shared/schemas'
import { and, asc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { orgQuotaEntitlements, orgQuotas } from '../db/schema'
import type { Database } from '../platform/interface'
import { quotaChangeDate, quotaChangeMetadata } from './quota-change-event'
import { cloudOrderEntitlementIncreaseBytes, cloudOrderEntitlementWhere } from './quota-entitlement-queries'
import {
  ensureTargetQuota,
  ensureTargetQuotaSync,
  storageQuotaDecreaseValues,
  trafficQuotaUpdateValues,
} from './quota-target'

type QuotaResourceType = 'storage' | 'traffic'
export async function applyQuotaChange(db: Database, event: CloudOrderQuotaChange): Promise<void> {
  await ensureTargetQuota(db, event.targetOrgId)
  if (event.storageBytes > 0) await applyResourceQuotaChange(db, event, 'storage', event.storageBytes)
  if (event.trafficBytes > 0) await applyTrafficQuotaChange(db, event)
}

export function applyQuotaChangeSync(db: Database, event: CloudOrderQuotaChange): void {
  ensureTargetQuotaSync(db, event.targetOrgId)
  if (event.storageBytes > 0) applyResourceQuotaChangeSync(db, event, 'storage', event.storageBytes)
  if (event.trafficBytes > 0) applyTrafficQuotaChangeSync(db, event)
}

async function applyResourceQuotaChange(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
  bytes: number,
) {
  if (event.direction === 'increase') {
    await upsertCloudOrderEntitlement(db, event, resourceType, bytes)
    return
  }

  const rows = await matchingCloudOrderEntitlementRows(db, event, resourceType)
  if (rows.length > 0) {
    const activeRows = rows.filter((row) => row.status === 'active')
    if (activeRows.length === 0) return

    const remaining = await applyEntitlementReduction(db, activeRows, bytes)
    if (remaining > 0) await reverseLegacyQuotaChange(db, event.targetOrgId, remaining)
    return
  }

  const remaining = await reduceActiveEntitlements(db, event.targetOrgId, resourceType, bytes, quotaChangeDate(event))
  if (remaining > 0) await reverseLegacyQuotaChange(db, event.targetOrgId, remaining)
}

function applyResourceQuotaChangeSync(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
  bytes: number,
) {
  if (event.direction === 'increase') {
    upsertCloudOrderEntitlementSync(db, event, resourceType, bytes)
    return
  }

  const rows = matchingCloudOrderEntitlementRowsSync(db, event, resourceType)
  if (rows.length > 0) {
    const activeRows = rows.filter((row) => row.status === 'active')
    if (activeRows.length === 0) return

    const remaining = applyEntitlementReductionSync(db, activeRows, bytes)
    if (remaining > 0) reverseLegacyQuotaChangeSync(db, event.targetOrgId, remaining)
    return
  }

  const remaining = reduceActiveEntitlementsSync(db, event.targetOrgId, resourceType, bytes, quotaChangeDate(event))
  if (remaining > 0) reverseLegacyQuotaChangeSync(db, event.targetOrgId, remaining)
}

async function applyTrafficQuotaChange(db: Database, event: CloudOrderQuotaChange) {
  await db
    .update(orgQuotas)
    .set(trafficQuotaUpdateValues(event.direction, event.trafficBytes))
    .where(eq(orgQuotas.orgId, event.targetOrgId))
}

function applyTrafficQuotaChangeSync(db: Database, event: CloudOrderQuotaChange) {
  ;(
    db
      .update(orgQuotas)
      .set(trafficQuotaUpdateValues(event.direction, event.trafficBytes))
      .where(eq(orgQuotas.orgId, event.targetOrgId)) as {
      run(): void
    }
  ).run()
}

async function upsertCloudOrderEntitlement(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
  bytes: number,
) {
  await db
    .insert(orgQuotaEntitlements)
    .values(cloudOrderEntitlementValues(event, resourceType, bytes))
    .onConflictDoUpdate({
      target: [
        orgQuotaEntitlements.orgId,
        orgQuotaEntitlements.resourceType,
        orgQuotaEntitlements.source,
        orgQuotaEntitlements.sourceId,
      ],
      set: {
        bytes: cloudOrderEntitlementIncreaseBytes(bytes),
        status: 'active',
        expiresAt: null,
        metadata: quotaChangeMetadata(event),
        updatedAt: new Date(),
      },
    })
}

function upsertCloudOrderEntitlementSync(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
  bytes: number,
) {
  ;(
    db
      .insert(orgQuotaEntitlements)
      .values(cloudOrderEntitlementValues(event, resourceType, bytes))
      .onConflictDoUpdate({
        target: [
          orgQuotaEntitlements.orgId,
          orgQuotaEntitlements.resourceType,
          orgQuotaEntitlements.source,
          orgQuotaEntitlements.sourceId,
        ],
        set: {
          bytes: cloudOrderEntitlementIncreaseBytes(bytes),
          status: 'active',
          expiresAt: null,
          metadata: quotaChangeMetadata(event),
          updatedAt: new Date(),
        },
      }) as { run(): void }
  ).run()
}

async function matchingCloudOrderEntitlementRows(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
) {
  return db
    .select({ id: orgQuotaEntitlements.id, bytes: orgQuotaEntitlements.bytes, status: orgQuotaEntitlements.status })
    .from(orgQuotaEntitlements)
    .where(cloudOrderEntitlementWhere(event, resourceType))
}

function matchingCloudOrderEntitlementRowsSync(
  db: Database,
  event: CloudOrderQuotaChange,
  resourceType: QuotaResourceType,
) {
  return (
    db
      .select({ id: orgQuotaEntitlements.id, bytes: orgQuotaEntitlements.bytes, status: orgQuotaEntitlements.status })
      .from(orgQuotaEntitlements)
      .where(cloudOrderEntitlementWhere(event, resourceType)) as {
      all(): Array<{ id: string; bytes: number; status: string }>
    }
  ).all()
}

async function reduceActiveEntitlements(
  db: Database,
  orgId: string,
  resourceType: QuotaResourceType,
  bytes: number,
  now: Date,
) {
  const rows = await activeEntitlementRows(db, orgId, resourceType, now)
  return applyEntitlementReduction(db, rows, bytes)
}

function reduceActiveEntitlementsSync(
  db: Database,
  orgId: string,
  resourceType: QuotaResourceType,
  bytes: number,
  now: Date,
) {
  const rows = (
    activeEntitlementRows(db, orgId, resourceType, now) as unknown as {
      all(): Array<{ id: string; bytes: number }>
    }
  ).all()
  return applyEntitlementReductionSync(db, rows, bytes)
}

function activeEntitlementRows(db: Database, orgId: string, resourceType: QuotaResourceType, now: Date) {
  const nowMs = now.getTime()
  return db
    .select({ id: orgQuotaEntitlements.id, bytes: orgQuotaEntitlements.bytes })
    .from(orgQuotaEntitlements)
    .where(
      and(
        eq(orgQuotaEntitlements.orgId, orgId),
        eq(orgQuotaEntitlements.resourceType, resourceType),
        eq(orgQuotaEntitlements.source, 'cloud_order'),
        eq(orgQuotaEntitlements.status, 'active'),
        sql`${orgQuotaEntitlements.startsAt} <= ${nowMs}`,
        sql`(${orgQuotaEntitlements.expiresAt} IS NULL OR ${orgQuotaEntitlements.expiresAt} > ${nowMs})`,
      ),
    )
    .orderBy(asc(orgQuotaEntitlements.createdAt))
}

async function applyEntitlementReduction(
  db: Database,
  rows: Array<{ id: string; bytes: number }>,
  bytes: number,
): Promise<number> {
  let remaining = bytes
  for (const row of rows) {
    if (remaining === 0) return 0
    await reduceEntitlementRow(db, row, remaining)
    remaining = Math.max(0, remaining - row.bytes)
  }
  return remaining
}

function applyEntitlementReductionSync(db: Database, rows: Array<{ id: string; bytes: number }>, bytes: number) {
  let remaining = bytes
  for (const row of rows) {
    if (remaining === 0) return 0
    reduceEntitlementRowSync(db, row, remaining)
    remaining = Math.max(0, remaining - row.bytes)
  }
  return remaining
}

async function reduceEntitlementRow(db: Database, row: { id: string; bytes: number }, bytes: number) {
  await db
    .update(orgQuotaEntitlements)
    .set(entitlementReductionValues(row.bytes, bytes))
    .where(eq(orgQuotaEntitlements.id, row.id))
}

function reduceEntitlementRowSync(db: Database, row: { id: string; bytes: number }, bytes: number) {
  ;(
    db
      .update(orgQuotaEntitlements)
      .set(entitlementReductionValues(row.bytes, bytes))
      .where(eq(orgQuotaEntitlements.id, row.id)) as { run(): void }
  ).run()
}

function entitlementReductionValues(rowBytes: number, bytes: number) {
  const now = new Date()
  if (rowBytes > bytes) return { bytes: rowBytes - bytes, updatedAt: now }
  return { status: 'revoked', expiresAt: now, updatedAt: now }
}

async function reverseLegacyQuotaChange(db: Database, orgId: string, bytes: number) {
  await db.update(orgQuotas).set(storageQuotaDecreaseValues(bytes)).where(eq(orgQuotas.orgId, orgId))
}

function reverseLegacyQuotaChangeSync(db: Database, orgId: string, bytes: number) {
  ;(
    db.update(orgQuotas).set(storageQuotaDecreaseValues(bytes)).where(eq(orgQuotas.orgId, orgId)) as {
      run(): void
    }
  ).run()
}

function cloudOrderEntitlementValues(event: CloudOrderQuotaChange, resourceType: QuotaResourceType, bytes: number) {
  const now = quotaChangeDate(event)
  return {
    id: nanoid(),
    orgId: event.targetOrgId,
    resourceType,
    source: 'cloud_order',
    sourceId: event.cloudOrderId,
    bytes,
    startsAt: now,
    expiresAt: null,
    status: 'active',
    metadata: quotaChangeMetadata(event),
    createdAt: now,
    updatedAt: now,
  }
}
