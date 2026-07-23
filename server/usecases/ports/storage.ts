import type { CreateStorageInput, PatchStorageInput, ReplaceStorageInput } from '@shared/schemas'
import type { Storage } from '@shared/types'

// Server-side record: the shared DTO, but timestamps stay as Date until the http
// layer serializes them. Drizzle row types never cross this boundary.
export type StorageRecord = Omit<Storage, 'createdAt' | 'updatedAt' | 'statusCheckedAt'> & {
  statusCheckedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type DeleteStorageResult = 'ok' | 'not_found' | 'in_use'

export interface StorageRepo {
  list(): Promise<{ items: StorageRecord[]; total: number }>
  get(id: string): Promise<StorageRecord | null>
  create(input: CreateStorageInput): Promise<StorageRecord>
  count(): Promise<number>
  replace(id: string, input: ReplaceStorageInput): Promise<StorageRecord | null>
  patch(id: string, input: PatchStorageInput): Promise<StorageRecord | null>
  delete(id: string): Promise<DeleteStorageResult>
  // Picks the oldest active storage with available capacity (uploads land here),
  // or validates and returns the requested storage against the same eligibility.
  // Throws 'No available storage' when none qualifies.
  select(id?: string): Promise<StorageRecord>
}
