import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { matters, torrentCacheConfigs, torrentFiles, torrents } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import { torrentFileObjectKey } from '../../domain/torrent-cache'
import type { Database } from '../../platform/interface'
import type {
  EvictionCandidate,
  TorrentCacheConfigRepo,
  TorrentFileRecord,
  TorrentRecord,
  TorrentRepo,
} from '../../usecases/ports'

const EVICTABLE_STATUSES = ['ready', 'invalid'] as const

// True when some drive file still references one of the torrent's objects, in
// any status including trash. Uses the (storage_id, object) index on matters.
const referenced = sql`EXISTS (
  SELECT 1 FROM ${matters}
  WHERE ${matters.storageId} = ${torrents.storageId}
    AND ${matters.object} >= 'bt/' || ${torrents.infoHash} || '/'
    AND ${matters.object} < 'bt/' || ${torrents.infoHash} || '0'
    AND ${matters.purgedAt} IS NULL
)`

function toTorrent(row: typeof torrents.$inferSelect): TorrentRecord {
  return {
    ...row,
    status: row.status as TorrentRecord['status'],
    verified: row.verified as TorrentRecord['verified'],
  }
}

export function createTorrentRepo(db: Database): TorrentRepo {
  async function get(id: string): Promise<TorrentRecord | null> {
    const rows = await db.select().from(torrents).where(eq(torrents.id, id)).limit(1)
    return rows[0] ? toTorrent(rows[0]) : null
  }

  const repo: TorrentRepo = {
    async create(input) {
      const now = input.now ?? new Date()
      const row: typeof torrents.$inferInsert = {
        id: generateId(),
        infoHash: input.infoHash.toLowerCase(),
        storageId: input.storageId,
        name: input.name,
        totalSize: input.files.reduce((sum, file) => sum + file.size, 0),
        fileCount: input.files.length,
        private: input.private,
        status: input.status,
        verified: input.verified ?? null,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceDownloaderId: input.sourceDownloaderId ?? null,
        lastAccessedAt: now,
        createdAt: now,
        updatedAt: now,
      }
      const fileRows = input.files.map((file) => ({
        torrentId: row.id,
        fileIdx: file.fileIdx,
        path: file.path,
        size: file.size,
        mime: file.mime,
        storageId: input.storageId,
        objectKey: torrentFileObjectKey(row.infoHash, file.fileIdx),
      }))
      await executeWriteTransaction(db, [
        db.insert(torrents).values(row),
        ...(fileRows.length > 0 ? [db.insert(torrentFiles).values(fileRows)] : []),
      ])
      return (await get(row.id)) as TorrentRecord
    },

    get,

    async getByInfoHash(infoHash) {
      const rows = await db.select().from(torrents).where(eq(torrents.infoHash, infoHash.toLowerCase())).limit(1)
      return rows[0] ? toTorrent(rows[0]) : null
    },

    async listFiles(torrentId): Promise<TorrentFileRecord[]> {
      return db
        .select()
        .from(torrentFiles)
        .where(eq(torrentFiles.torrentId, torrentId))
        .orderBy(asc(torrentFiles.fileIdx))
    },

    async createIfAbsent(input) {
      const existing = await repo.getByInfoHash(input.infoHash)
      if (existing) return { created: false, torrent: existing }
      try {
        return { created: true, torrent: await repo.create(input) }
      } catch (error) {
        const winner = await repo.getByInfoHash(input.infoHash)
        if (winner) return { created: false, torrent: winner }
        throw error
      }
    },

    async setSource(id, source, now) {
      await db
        .update(torrents)
        .set({ sourceTaskId: source.taskId, sourceDownloaderId: source.downloaderId, updatedAt: now })
        .where(eq(torrents.id, id))
    },

    async transition(id, from, to, fields = {}) {
      const now = fields.now ?? new Date()
      const rows = await db
        .update(torrents)
        .set({
          status: to,
          updatedAt: now,
          ...(fields.verified === undefined ? {} : { verified: fields.verified }),
        })
        .where(and(eq(torrents.id, id), inArray(torrents.status, [...from])))
        .returning({ id: torrents.id })
      return rows.length === 1
    },

    async touch(id, statuses, now) {
      const rows = await db
        .update(torrents)
        .set({ lastAccessedAt: now, updatedAt: now })
        .where(and(eq(torrents.id, id), inArray(torrents.status, [...statuses])))
        .returning({ id: torrents.id })
      return rows.length === 1
    },

    async markFileUploaded(torrentId, fileIdx, now) {
      await db
        .update(torrentFiles)
        .set({ uploadedAt: now })
        .where(and(eq(torrentFiles.torrentId, torrentId), eq(torrentFiles.fileIdx, fileIdx)))
    },

    async listEvictionCandidates(limit): Promise<EvictionCandidate[]> {
      return db
        .select({
          id: torrents.id,
          infoHash: torrents.infoHash,
          storageId: torrents.storageId,
          size: torrents.totalSize,
          lastAccessedAt: torrents.lastAccessedAt,
        })
        .from(torrents)
        .where(and(inArray(torrents.status, [...EVICTABLE_STATUSES]), sql`NOT ${referenced}`))
        .orderBy(asc(torrents.lastAccessedAt), asc(torrents.id))
        .limit(limit)
    },

    async totalSize() {
      const rows = await db.select({ total: sql<number>`COALESCE(SUM(${torrents.totalSize}), 0)` }).from(torrents)
      return Number(rows[0]?.total ?? 0)
    },

    async claimForEviction(candidate) {
      const rows = await db
        .update(torrents)
        .set({ status: 'evicting', updatedAt: new Date() })
        .where(
          and(
            eq(torrents.id, candidate.id),
            inArray(torrents.status, [...EVICTABLE_STATUSES]),
            eq(torrents.lastAccessedAt, candidate.lastAccessedAt),
            sql`NOT ${referenced}`,
          ),
        )
        .returning({ id: torrents.id })
      return rows.length === 1
    },

    async delete(id) {
      await executeWriteTransaction(db, [
        db.delete(torrentFiles).where(eq(torrentFiles.torrentId, id)),
        db.delete(torrents).where(eq(torrents.id, id)),
      ])
    },
  }
  return repo
}

export function createTorrentCacheConfigRepo(db: Database): TorrentCacheConfigRepo {
  return {
    async getFolder(orgId) {
      const rows = await db
        .select({ folder: torrentCacheConfigs.folder })
        .from(torrentCacheConfigs)
        .where(eq(torrentCacheConfigs.orgId, orgId))
        .limit(1)
      return rows[0]?.folder ?? null
    },

    async setFolder(orgId, folder) {
      const now = new Date()
      await db
        .insert(torrentCacheConfigs)
        .values({ orgId, folder, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: torrentCacheConfigs.orgId, set: { folder, updatedAt: now } })
    },
  }
}
