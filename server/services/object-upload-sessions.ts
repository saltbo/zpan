import type { PatchObjectUploadSessionInput } from '@shared/schemas'
import type { ObjectUploadSession } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { objectUploadSessions } from '../db/schema'
import type { Database } from '../platform/interface'
import type { StorageRecord as S3Storage } from '../usecases/ports'
import type { S3Service } from './s3'

const DEFAULT_PART_SIZE = 16 * 1024 * 1024
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export class ObjectUploadSessionError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_state' | 'storage_failure',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ObjectUploadSessionError'
  }
}

type SessionRow = typeof objectUploadSessions.$inferSelect

export async function createObjectUploadSession(
  db: Database,
  s3: S3Service,
  params: {
    orgId: string
    objectId: string
    storage: S3Storage
    storageKey: string
    contentType: string
    partSize?: number
    actorId: string
  },
): Promise<ObjectUploadSession> {
  const now = new Date()
  let uploadId: string
  try {
    uploadId = await s3.createMultipartUpload(params.storage, params.storageKey, params.contentType)
  } catch (error) {
    throw new ObjectUploadSessionError(
      'storage_failure',
      `Storage multipart upload failed: ${(error as Error).message}`,
    )
  }
  const row: typeof objectUploadSessions.$inferInsert = {
    id: nanoid(),
    orgId: params.orgId,
    objectId: params.objectId,
    storageId: params.storage.id,
    storageKey: params.storageKey,
    uploadId,
    partSize: params.partSize ?? DEFAULT_PART_SIZE,
    status: 'active',
    createdBy: params.actorId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(objectUploadSessions).values(row)
  return toDto(row as SessionRow)
}

export async function getObjectUploadSession(
  db: Database,
  orgId: string,
  objectId: string,
  id: string,
): Promise<ObjectUploadSession> {
  const row = await getRow(db, orgId, objectId, id)
  if (!row) throw new ObjectUploadSessionError('not_found')
  return toDto(row)
}

export async function presignObjectUploadParts(
  db: Database,
  s3: S3Service,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: S3Storage
    partNumbers: number[]
  },
): Promise<{ uploadId: string; partSize: number; parts: Array<{ partNumber: number; url: string }> }> {
  const row = await getRow(db, params.orgId, params.objectId, params.sessionId)
  if (!row) throw new ObjectUploadSessionError('not_found')
  if (row.status !== 'active' || row.expiresAt.getTime() <= Date.now()) {
    throw new ObjectUploadSessionError('invalid_state')
  }
  const parts = await Promise.all(
    params.partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await s3.presignUploadPart(params.storage, row.storageKey, row.uploadId, partNumber),
    })),
  )
  return { uploadId: row.uploadId, partSize: row.partSize, parts }
}

export async function patchObjectUploadSession(
  db: Database,
  s3: S3Service,
  params: {
    orgId: string
    objectId: string
    sessionId: string
    storage: S3Storage
    input: PatchObjectUploadSessionInput
  },
): Promise<ObjectUploadSession> {
  const row = await getRow(db, params.orgId, params.objectId, params.sessionId)
  if (!row) throw new ObjectUploadSessionError('not_found')
  if (row.status !== 'active') throw new ObjectUploadSessionError('invalid_state')
  const now = new Date()
  if (params.input.action === 'complete') {
    try {
      await s3.completeMultipartUpload(params.storage, row.storageKey, row.uploadId, params.input.parts)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload complete failed: ${(error as Error).message}`,
      )
    }
    await db
      .update(objectUploadSessions)
      .set({ status: 'completed', updatedAt: now })
      .where(eq(objectUploadSessions.id, row.id))
  } else {
    try {
      await s3.abortMultipartUpload(params.storage, row.storageKey, row.uploadId)
    } catch (error) {
      throw new ObjectUploadSessionError(
        'storage_failure',
        `Storage multipart upload abort failed: ${(error as Error).message}`,
      )
    }
    await db
      .update(objectUploadSessions)
      .set({ status: 'aborted', updatedAt: now })
      .where(eq(objectUploadSessions.id, row.id))
  }
  return getObjectUploadSession(db, params.orgId, params.objectId, params.sessionId)
}

async function getRow(db: Database, orgId: string, objectId: string, id: string): Promise<SessionRow | null> {
  const rows = await db
    .select()
    .from(objectUploadSessions)
    .where(
      and(
        eq(objectUploadSessions.id, id),
        eq(objectUploadSessions.orgId, orgId),
        eq(objectUploadSessions.objectId, objectId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

function toDto(row: SessionRow): ObjectUploadSession {
  return {
    id: row.id,
    objectId: row.objectId,
    uploadId: row.uploadId,
    partSize: row.partSize,
    status: row.status as ObjectUploadSession['status'],
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
