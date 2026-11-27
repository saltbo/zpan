export class StorageQuotaExceededError extends Error {
  constructor() {
    super('QUOTA_EXCEEDED')
    this.name = 'StorageQuotaExceededError'
  }
}

export interface StorageUsageReservation {
  orgId: string
  // Null reserves org quota only, for a reference to bytes already counted in
  // its storage (a torrent file).
  storageId: string | null
  bytes: number
  // Bytes added to the storage when they differ from the org's: overwriting a
  // file that references a torrent frees its org quota, but none of the
  // storage's bytes. Defaults to `bytes`.
  storageBytes?: number
}

export interface ReserveStorageUsageInput extends StorageUsageReservation {
  teamQuotaEnabled?: boolean
}

export interface StorageUsageRepo {
  // Decrement org + storage `used` counters for the given reservations (floored at 0).
  rollbackReservations(reservations: Iterable<StorageUsageReservation | null>): Promise<void>
  // Recompute org (and optionally specific storages') `used` from live matter/image rows.
  reconcile(orgId: string, storageIds?: Iterable<string>): Promise<void>
  // Recompute storages' `used` alone, e.g. after torrent objects are evicted.
  reconcileStorages(storageIds: Iterable<string>): Promise<void>
}
