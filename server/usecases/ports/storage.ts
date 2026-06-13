import type { CreateStorageInput, UpdateStorageInput } from '@shared/schemas'
import type { Storage } from '@shared/types'

// Server-side record: the shared DTO, but timestamps stay as Date until the http
// layer serializes them. Drizzle row types never cross this boundary.
export type StorageRecord = Omit<Storage, 'createdAt' | 'updatedAt'> & {
  createdAt: Date
  updatedAt: Date
}

export type DeleteStorageResult = 'ok' | 'not_found' | 'in_use'

export interface StorageRepo {
  list(): Promise<{ items: StorageRecord[]; total: number }>
  get(id: string): Promise<StorageRecord | null>
  create(input: CreateStorageInput): Promise<StorageRecord>
  count(): Promise<number>
  update(id: string, input: UpdateStorageInput): Promise<StorageRecord | null>
  delete(id: string): Promise<DeleteStorageResult>
  select(mode: 'private' | 'public'): Promise<StorageRecord>
}
