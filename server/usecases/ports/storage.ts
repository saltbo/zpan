import type { CreateStorageInput, PatchStorageInput, ReplaceStorageInput } from '@shared/schemas'
import type { Storage } from '@shared/types'
import type { S3StorageCredentials } from './s3'

// Server-side record: the public storage representation plus the write-only S3
// secret; timestamps stay as Date until the HTTP layer serializes them.
// Drizzle row types never cross this boundary.
export type StorageRecord = Omit<Storage, 'createdAt' | 'updatedAt' | 'statusCheckedAt'> &
  S3StorageCredentials & {
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
