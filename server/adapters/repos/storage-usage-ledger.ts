import { DirType } from '@shared/constants'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { imageHostings, matters, storageUsageLedger } from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'

export type StorageUsageResourceType = 'matter' | 'image_hosting' | 'storage'

export type StorageUsageReason =
  | 'opening_balance'
  | 'opening_balance_complete'
  | 'matter_activated'
  | 'matter_resized'
  | 'matter_purged'
  | 'image_activated'
  | 'image_purged'

export interface StorageUsageLedgerMutation {
  eventKey?: string
  orgId: string
  storageId: string
  resourceType: StorageUsageResourceType
  resourceId: string
  deltaBytes: number
  reason: StorageUsageReason
  occurredAt: Date
}

function openingEventKey(orgId: string, storageId: string): string {
  return `opening:${orgId}:${storageId}`
}

export function storageUsageOpeningBalanceQuery(
  db: Database,
  orgId: string,
  storageId: string,
  occurredAt: Date,
): AtomicQuery {
  const eventKey = openingEventKey(orgId, storageId)
  return db
    .insert(storageUsageLedger)
    .values({
      id: eventKey,
      eventKey,
      orgId,
      storageId,
      resourceType: 'storage',
      resourceId: storageId,
      deltaBytes: sql<number>`COALESCE((
        SELECT SUM(${matters.size})
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.storageId} = ${storageId}
          AND ${matters.dirtype} = ${DirType.FILE}
          AND ${matters.status} = 'active'
          AND ${matters.purgedAt} IS NULL
      ), 0) + COALESCE((
        SELECT SUM(${imageHostings.size})
        FROM ${imageHostings}
        WHERE ${imageHostings.orgId} = ${orgId}
          AND ${imageHostings.storageId} = ${storageId}
          AND ${imageHostings.status} = 'active'
          AND ${imageHostings.purgedAt} IS NULL
      ), 0)`,
      reason: 'opening_balance',
      occurredAt,
      createdAt: occurredAt,
    })
    .onConflictDoNothing({ target: storageUsageLedger.eventKey })
}

export function storageUsageMutationQuery(db: Database, mutation: StorageUsageLedgerMutation): AtomicQuery {
  const eventKey = mutation.eventKey ?? `mutation:${nanoid()}`
  return db
    .insert(storageUsageLedger)
    .values({
      id: nanoid(),
      eventKey,
      orgId: mutation.orgId,
      storageId: mutation.storageId,
      resourceType: mutation.resourceType,
      resourceId: mutation.resourceId,
      deltaBytes: mutation.deltaBytes,
      reason: mutation.reason,
      occurredAt: mutation.occurredAt,
      createdAt: mutation.occurredAt,
    })
    .onConflictDoNothing({ target: storageUsageLedger.eventKey })
}

function conditionalMutationQuery(db: Database, selection: ReturnType<typeof sql>): AtomicQuery {
  return db.insert(storageUsageLedger).select(selection).onConflictDoNothing({ target: storageUsageLedger.eventKey })
}

export function matterActivationLedgerQuery(
  db: Database,
  orgId: string,
  matterId: string,
  occurredAt: Date,
): AtomicQuery {
  const eventKey = `matter:${matterId}:activated`
  return conditionalMutationQuery(
    db,
    sql`SELECT
      ${nanoid()}, ${eventKey}, ${matters.orgId}, ${matters.storageId}, 'matter', ${matters.id},
      ${matters.size}, 'matter_activated', ${occurredAt.getTime()}, ${occurredAt.getTime()}
    FROM ${matters}
    WHERE ${matters.id} = ${matterId}
      AND ${matters.orgId} = ${orgId}
      AND ${matters.status} = 'active'
      AND ${matters.dirtype} = ${DirType.FILE}
      AND ${matters.purgedAt} IS NULL
      AND COALESCE(${matters.size}, 0) > 0`,
  )
}

export function matterResizeLedgerQuery(
  db: Database,
  orgId: string,
  matterId: string,
  nextSize: number,
  occurredAt: Date,
): AtomicQuery {
  return conditionalMutationQuery(
    db,
    sql`SELECT
      ${nanoid()}, ${`matter:${matterId}:resized:${nanoid()}`}, ${matters.orgId}, ${matters.storageId}, 'matter',
      ${matters.id}, ${nextSize} - COALESCE(${matters.size}, 0), 'matter_resized',
      ${occurredAt.getTime()}, ${occurredAt.getTime()}
    FROM ${matters}
    WHERE ${matters.id} = ${matterId}
      AND ${matters.orgId} = ${orgId}
      AND ${matters.status} = 'active'
      AND ${matters.dirtype} = ${DirType.FILE}
      AND ${matters.purgedAt} IS NULL
      AND ${nextSize} <> COALESCE(${matters.size}, 0)`,
  )
}

export function matterPurgeLedgerQuery(db: Database, orgId: string, matterId: string, occurredAt: Date): AtomicQuery {
  const eventKey = `matter:${matterId}:purged`
  return conditionalMutationQuery(
    db,
    sql`SELECT
      ${nanoid()}, ${eventKey}, ${matters.orgId}, ${matters.storageId}, 'matter', ${matters.id},
      -COALESCE(${matters.size}, 0), 'matter_purged', ${occurredAt.getTime()}, ${occurredAt.getTime()}
    FROM ${matters}
    WHERE ${matters.id} = ${matterId}
      AND ${matters.orgId} = ${orgId}
      AND ${matters.status} = 'active'
      AND ${matters.dirtype} = ${DirType.FILE}
      AND ${matters.purgedAt} IS NULL
      AND COALESCE(${matters.size}, 0) > 0`,
  )
}

export function imageActivationLedgerQuery(
  db: Database,
  orgId: string,
  imageId: string,
  occurredAt: Date,
): AtomicQuery {
  const eventKey = `image:${imageId}:activated`
  return conditionalMutationQuery(
    db,
    sql`SELECT
      ${nanoid()}, ${eventKey}, ${imageHostings.orgId}, ${imageHostings.storageId}, 'image_hosting',
      ${imageHostings.id}, ${imageHostings.size}, 'image_activated', ${occurredAt.getTime()}, ${occurredAt.getTime()}
    FROM ${imageHostings}
    WHERE ${imageHostings.id} = ${imageId}
      AND ${imageHostings.orgId} = ${orgId}
      AND ${imageHostings.status} = 'active'
      AND ${imageHostings.purgedAt} IS NULL
      AND ${imageHostings.size} > 0`,
  )
}

export function imagePurgeLedgerQuery(db: Database, orgId: string, imageId: string, occurredAt: Date): AtomicQuery {
  const eventKey = `image:${imageId}:purged`
  return conditionalMutationQuery(
    db,
    sql`SELECT
      ${nanoid()}, ${eventKey}, ${imageHostings.orgId}, ${imageHostings.storageId}, 'image_hosting',
      ${imageHostings.id}, -${imageHostings.size}, 'image_purged', ${occurredAt.getTime()}, ${occurredAt.getTime()}
    FROM ${imageHostings}
    WHERE ${imageHostings.id} = ${imageId}
      AND ${imageHostings.orgId} = ${orgId}
      AND ${imageHostings.status} = 'active'
      AND ${imageHostings.purgedAt} IS NULL
      AND ${imageHostings.size} > 0`,
  )
}

export async function ensureStorageUsageOpeningBalances(db: Database, occurredAt: Date): Promise<void> {
  const [matterPairs, imagePairs] = await Promise.all([
    db
      .selectDistinct({ orgId: matters.orgId, storageId: matters.storageId })
      .from(matters)
      .where(and(eq(matters.dirtype, DirType.FILE), eq(matters.status, 'active'), isNull(matters.purgedAt))),
    db
      .selectDistinct({ orgId: imageHostings.orgId, storageId: imageHostings.storageId })
      .from(imageHostings)
      .where(and(eq(imageHostings.status, 'active'), isNull(imageHostings.purgedAt))),
  ])

  const pairs = new Map<string, { orgId: string; storageId: string }>()
  for (const pair of [...matterPairs, ...imagePairs]) {
    pairs.set(`${pair.orgId}\u0000${pair.storageId}`, pair)
  }

  const queries = [...pairs.values()].map(({ orgId, storageId }) =>
    storageUsageOpeningBalanceQuery(db, orgId, storageId, occurredAt),
  )
  for (let offset = 0; offset < queries.length; offset += 50) {
    await executeWriteTransaction(db, queries.slice(offset, offset + 50))
  }
  await executeWriteTransaction(db, [
    storageUsageMutationQuery(db, {
      eventKey: 'opening:complete',
      orgId: '',
      storageId: '',
      resourceType: 'storage',
      resourceId: 'global',
      deltaBytes: 0,
      reason: 'opening_balance_complete',
      occurredAt,
    }),
  ])
}
