import type { PatchObjectUploadSessionInput } from '@shared/schemas'
import type { ObjectUploadSession } from '@shared/types'
import {
  ObjectUploadSessionError,
  type ObjectUploadSessionRecord,
  type ObjectUploadSessionRepo,
  type S3Gateway,
  type StorageRecord,
} from './ports'

export type ObjectUploadSessionDeps = { s3: S3Gateway; objectUploadSessions: ObjectUploadSessionRepo }

const DEFAULT_PART_SIZE = 16 * 1024 * 1024

function toDto(record: ObjectUploadSessionRecord): ObjectUploadSession {
  return {
    id: record.id,
    objectId: record.objectId,
    uploadId: record.uploadId,
    partSize: record.partSize,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

export async function createObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    storage: StorageRecord
    storageKey: string
    contentType: string
    partSize?: number
    actorId: string
  },
): Promise<ObjectUploadSession> {
  let uploadId: string
  try {
    uploadId = await deps.s3.createMultipartUpload(params.storage, params.storageKey, params.contentType)
  } catch (error) {
    throw new ObjectUploadSessionError(
      'storage_failure',
      `Storage multipart upload failed: ${(error as Error).message}`,
    )
  }
  const record = await deps.objectUploadSessions.create({
    orgId: params.orgId,
    objectId: params.objectId,
    storageId: params.storage.id,
    storageKey: params.storageKey,
    uploadId,
    partSize: params.partSize ?? DEFAULT_PART_SIZE,
    actorId: params.actorId,
  })
  return toDto(record)
}

export async function getObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  orgId: string,
  objectId: string,
  id: string,
): Promise<ObjectUploadSession> {
  const record = await deps.objectUploadSessions.get(orgId, objectId, id)
  if (!record) throw new ObjectUploadSessionError('not_found')
  return toDto(record)
}

export async function presignObjectUploadParts(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: StorageRecord
    partNumbers: number[]
  },
): Promise<{ uploadId: string; partSize: number; parts: Array<{ partNumber: number; url: string }> }> {
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active' || record.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  const parts = await Promise.all(
    params.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await deps.s3.presignUploadPart(params.storage, record.storageKey, record.uploadId, partNumber),
    })),
  )
  return { uploadId: record.uploadId, partSize: record.partSize, parts }
}

export async function patchObjectUploadSession(
  deps: ObjectUploadSessionDeps,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: StorageRecord
    input: PatchObjectUploadSessionInput
  },
): Promise<ObjectUploadSession> {
  const record = await deps.objectUploadSessions.get(params.orgId, params.objectId, params.sessionId)
  if (!record) throw new ObjectUploadSessionError('not_found')
  if (record.status !== 'active') throw new ObjectUploadSessionError('invalid_state')
  if (params.input.action === 'complete') {
    try {
      await deps.s3.completeMultipartUpload(params.storage, record.storageKey, record.uploadId, params.input.parts)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload complete failed: ${(error as Error).message}`,
      )
    }
    await deps.objectUploadSessions.setStatus(record.id, 'completed')
  } else {
    try {
      await deps.s3.abortMultipartUpload(params.storage, record.storageKey, record.uploadId)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload abort failed: ${(error as Error).message}`,
      )
    }
    await deps.objectUploadSessions.setStatus(record.id, 'aborted')
  }
  return getObjectUploadSession(deps, params.orgId, params.objectId, params.sessionId)
}

export { ObjectUploadSessionError } from './ports'
