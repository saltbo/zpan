export class StorageQuotaExceededError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED')
    this.name = 'StorageQuotaExceededError'
  }
}

export interface StorageUsageReservation {
  orgId: string
  // Null reserves org quota only, for a reference to bytes already counted in
  // its storage (a cached torrent file).
  storageId: string | null
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
  // Recompute storages' `used` alone, e.g. after cached torrent objects are evicted.
  reconcileStorages(storageIds: Iterable<string>): Promise<void>
}
