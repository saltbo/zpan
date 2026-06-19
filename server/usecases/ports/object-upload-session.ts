// Server-side record: the shared ObjectUploadSession DTO, but timestamps stay as
// Date until the usecase serializes them for http. Drizzle rows never cross here.
import type { ConflictStrategy } from '@shared/schemas'
import type { ObjectUploadSession } from '@shared/types'

export type ObjectUploadSessionRecord = Omit<ObjectUploadSession, 'expiresAt' | 'createdAt' | 'updatedAt'> & {
  storageKey: string
  // The conflict strategy chosen at create time, applied when the upload is
  // finalized (a deferred 'replace' purges the incumbent only once bytes land).
  onConflict: ConflictStrategy
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface CreateObjectUploadSessionInput {
  orgId: string
  objectId: string
  storageId: string
  storageKey: string
  // null for a single-PutObject (≤5 GiB) session; set for S3 multipart.
  uploadId: string | null
  partSize: number
  onConflict: ConflictStrategy
  actorId: string
}

// Port-level error thrown by the usecase, caught by the http layer and mapped to
// 404 / 409 / 502.
export class ObjectUploadSessionError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_state' | 'storage_failure',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ObjectUploadSessionError'
  }
}

export interface ObjectUploadSessionRepo {
  create(input: CreateObjectUploadSessionInput): Promise<ObjectUploadSessionRecord>
  get(orgId: string, objectId: string, id: string): Promise<ObjectUploadSessionRecord | null>
  setStatus(id: string, status: 'completed' | 'aborted'): Promise<void>
}
