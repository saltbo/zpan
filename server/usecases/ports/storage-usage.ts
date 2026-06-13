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

export interface StorageUsageRepo {
  // Decrement org + storage `used` counters for the given reservations (floored at 0).
  rollbackReservations(reservations: Iterable<StorageUsageReservation | null>): Promise<void>
  // Recompute org (and optionally specific storages') `used` from live matter/image rows.
  reconcile(orgId: string, storageIds?: Iterable<string>): Promise<void>
}
