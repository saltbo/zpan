import { eq, sql } from 'drizzle-orm'
import { DirType } from '../../shared/constants'
import { imageHostings, matters, orgQuotas, storages } from '../db/schema'
import type { Database } from '../platform/interface'
import { incrementUsageIfEffectiveQuotaAllows } from './effective-quota'

export class StorageQuotaExceededError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED')
    this.name = 'StorageQuotaExceededError'
  }
}

export interface StorageUsageReservation {
  orgId: string
  storageId: string
  bytes: number
}

export interface ReserveStorageUsageInput extends StorageUsageReservation {
  teamQuotaEnabled?: boolean
}

type RollbackCleanup = () => Promise<void> | void

export class StorageUsageMutationContext {
  private readonly cleanups: RollbackCleanup[] = []

  onRollback(cleanup: RollbackCleanup): void {
    this.cleanups.push(cleanup)
  }

  async rollbackCleanups(): Promise<void> {
    for (const cleanup of [...this.cleanups].reverse()) {
      await cleanup()
    }
  }
}

async function rollbackReservationMutation(
  db: Database,
  reservations: StorageUsageReservation[],
  ctx: StorageUsageMutationContext,
  originalError: unknown,
): Promise<never> {
  let rollbackError: unknown

  try {
    await ctx.rollbackCleanups()
  } catch (error) {
    rollbackError = error
  }

  try {
    await rollbackStorageUsageReservations(db, reservations)
  } catch (error) {
    rollbackError ??= error
  }

  if (rollbackError) {
    throw rollbackError
  }
  throw originalError
}

export async function reserveStorageUsage(
  db: Database,
  input: ReserveStorageUsageInput,
): Promise<StorageUsageReservation | null> {
  if (input.bytes <= 0) return null
  const allowed = await incrementUsageIfEffectiveQuotaAllows(
    db,
    input.orgId,
    input.storageId,
    input.bytes,
    input.teamQuotaEnabled ?? true,
  )
  if (!allowed) throw new StorageQuotaExceededError()
  return { orgId: input.orgId, storageId: input.storageId, bytes: input.bytes }
}

export async function rollbackStorageUsageReservations(
  db: Database,
  reservations: Iterable<StorageUsageReservation | null>,
): Promise<void> {
  const bytesByStorage = new Map<string, number>()
  const bytesByOrg = new Map<string, number>()

  for (const reservation of reservations) {
    if (!reservation || reservation.bytes <= 0) continue
    bytesByStorage.set(reservation.storageId, (bytesByStorage.get(reservation.storageId) ?? 0) + reservation.bytes)
    bytesByOrg.set(reservation.orgId, (bytesByOrg.get(reservation.orgId) ?? 0) + reservation.bytes)
  }

  for (const [storageId, bytes] of bytesByStorage) {
    await db
      .update(storages)
      .set({ used: sql`MAX(0, ${storages.used} - ${bytes})` })
      .where(eq(storages.id, storageId))
  }

  for (const [orgId, bytes] of bytesByOrg) {
    await db
      .update(orgQuotas)
      .set({ used: sql`MAX(0, ${orgQuotas.used} - ${bytes})` })
      .where(eq(orgQuotas.orgId, orgId))
  }
}

export async function withStorageUsageReservation<T>(
  db: Database,
  inputs: ReserveStorageUsageInput | ReserveStorageUsageInput[],
  action: (ctx: StorageUsageMutationContext) => Promise<T>,
): Promise<T> {
  const reservations: StorageUsageReservation[] = []
  const ctx = new StorageUsageMutationContext()

  try {
    for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
      const reservation = await reserveStorageUsage(db, input)
      if (reservation) reservations.push(reservation)
    }
    return await action(ctx)
  } catch (error) {
    return rollbackReservationMutation(db, reservations, ctx, error)
  }
}

export async function reconcileStorageUsage(
  db: Database,
  orgId: string,
  storageIds: Iterable<string> = [],
): Promise<void> {
  await db
    .update(orgQuotas)
    .set({
      used: sql`COALESCE((
        SELECT SUM(${matters.size})
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.dirtype} = ${DirType.FILE}
          AND ${matters.status} IN ('active', 'trashed')
      ), 0) + COALESCE((
        SELECT SUM(${imageHostings.size})
        FROM ${imageHostings}
        WHERE ${imageHostings.orgId} = ${orgId}
          AND ${imageHostings.status} = 'active'
      ), 0)`,
    })
    .where(eq(orgQuotas.orgId, orgId))

  for (const storageId of new Set(storageIds)) {
    await db
      .update(storages)
      .set({
        used: sql`COALESCE((
          SELECT SUM(${matters.size})
          FROM ${matters}
          WHERE ${matters.storageId} = ${storageId}
            AND ${matters.dirtype} = ${DirType.FILE}
            AND ${matters.status} IN ('active', 'trashed')
        ), 0) + COALESCE((
          SELECT SUM(${imageHostings.size})
          FROM ${imageHostings}
          WHERE ${imageHostings.storageId} = ${storageId}
            AND ${imageHostings.status} = 'active'
        ), 0)`,
      })
      .where(eq(storages.id, storageId))
  }
}
