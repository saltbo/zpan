import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { objectUploadSessions } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { ObjectUploadSessionRecord, ObjectUploadSessionRepo } from '../../usecases/ports'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type SessionRow = typeof objectUploadSessions.$inferSelect

function toRecord(row: SessionRow): ObjectUploadSessionRecord {
  return {
    id: row.id,
    objectId: row.objectId,
    uploadId: row.uploadId,
    partSize: row.partSize,
    status: row.status as ObjectUploadSessionRecord['status'],
    storageKey: row.storageKey,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createObjectUploadSessionRepo(db: Database): ObjectUploadSessionRepo {
  return {
    async create(input) {
      const now = new Date()
      const row: typeof objectUploadSessions.$inferInsert = {
        id: nanoid(),
        orgId: input.orgId,
        objectId: input.objectId,
        storageId: input.storageId,
        storageKey: input.storageKey,
        uploadId: input.uploadId,
        partSize: input.partSize,
        status: 'active',
        createdBy: input.actorId,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(objectUploadSessions).values(row)
      return toRecord(row as SessionRow)
    },

    async get(orgId, objectId, id) {
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
      const row = rows[0]
      return row ? toRecord(row) : null
    },

    async setStatus(id, status) {
      await db
        .update(objectUploadSessions)
        .set({ status, updatedAt: new Date() })
        .where(eq(objectUploadSessions.id, id))
    },
  }
}
