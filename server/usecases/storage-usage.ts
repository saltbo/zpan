import {
  type QuotaRepo,
  type ReserveStorageUsageInput,
  StorageQuotaExceededError,
  type StorageUsageRepo,
  type StorageUsageReservation,
} from './ports'

export type StorageUsageDeps = { quota: QuotaRepo; storageUsage: StorageUsageRepo }

type RollbackCleanup = () => Promise<void> | void

// Tracks side effects to undo if a reservation-guarded action throws.
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
  deps: StorageUsageDeps,
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
    await deps.storageUsage.rollbackReservations(reservations)
  } catch (error) {
    rollbackError ??= error
  }
  if (rollbackError) throw rollbackError
  throw originalError
}

export async function reserveStorageUsage(
  deps: StorageUsageDeps,
  input: ReserveStorageUsageInput,
): Promise<StorageUsageReservation | null> {
  if (input.bytes <= 0) return null
  const allowed = await deps.quota.incrementUsageIfEffectiveQuotaAllows(
    input.orgId,
    input.storageId,
    input.bytes,
    input.teamQuotaEnabled ?? true,
  )
  if (!allowed) throw new StorageQuotaExceededError()
  return { orgId: input.orgId, storageId: input.storageId, bytes: input.bytes }
}

export async function withStorageUsageReservation<T>(
  deps: StorageUsageDeps,
  inputs: ReserveStorageUsageInput | ReserveStorageUsageInput[],
  action: (ctx: StorageUsageMutationContext) => Promise<T>,
): Promise<T> {
  const reservations: StorageUsageReservation[] = []
  const ctx = new StorageUsageMutationContext()
  try {
    for (const input of Array.isArray(inputs) ? inputs : [inputs]) {
      const reservation = await reserveStorageUsage(deps, input)
      if (reservation) reservations.push(reservation)
    }
    return await action(ctx)
  } catch (error) {
    return rollbackReservationMutation(deps, reservations, ctx, error)
  }
}

export { StorageQuotaExceededError } from './ports'
