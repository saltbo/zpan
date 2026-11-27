import { ObjectStatus } from '@shared/constants'
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { downloaders, matters, stremthruLinks, torrentFiles, torrents, workspaceTorrents } from '../../db/schema'
import { executeWriteTransaction, rowsPerInsert } from '../../db/transaction'
import { torrentEntryObjectKey, torrentKeyRange, torrentTreeLayoutPath, torrentTreeRoot } from '../../domain/torrents'
import type { Database } from '../../platform/interface'
import type {
  AdminTorrentRecord,
  EvictionCandidate,
  StremThruLinkRepo,
  TorrentEntryRecord,
  TorrentFileRecord,
  TorrentRecord,
  TorrentRepo,
} from '../../usecases/ports'
import { afterCreatedAtId, keysetPage } from './keyset'

const EVICTABLE_STATUSES = ['ready', 'invalid'] as const
// D1 binds at most 100 parameters per statement.
const IN_CHUNK = 90

function chunkBy<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function chunks<T>(items: readonly T[]): T[][] {
  return chunkBy(items, IN_CHUNK)
}

// True when some drive file still references one of the torrent's objects, in
// any status including trash (through the (storage_id, object) index on
// matters), or some Torrents list entry holds it.
const referenced = sql`(EXISTS (
  SELECT 1 FROM ${matters}
  WHERE ${matters.storageId} = ${torrents.storageId}
    AND ${matters.object} >= 'bt/' || ${torrents.infoHash} || '/'
    AND ${matters.object} < 'bt/' || ${torrents.infoHash} || '0'
    AND ${matters.purgedAt} IS NULL
) OR EXISTS (
  SELECT 1 FROM ${workspaceTorrents} WHERE ${workspaceTorrents.torrentId} = ${torrents.id}
))`

// Drive files, live or in trash, that reference one of the torrent's objects,
// plus the Torrents list entries that hold it. Written with qualified names,
// because drizzle drops the table from columns in a select list, which would
// bind them to the subqueries' own tables.
const holderCount = sql<number>`${sql.raw(`((
  SELECT COUNT(*) FROM "matters"
  WHERE "matters"."storage_id" = "torrents"."storage_id"
    AND "matters"."object" >= 'bt/' || "torrents"."info_hash" || '/'
    AND "matters"."object" < 'bt/' || "torrents"."info_hash" || '0'
    AND "matters"."purged_at" IS NULL
) + (
  SELECT COUNT(*) FROM "workspace_torrents" WHERE "workspace_torrents"."torrent_id" = "torrents"."id"
))`)}`.mapWith(Number)

function toEntry(row: typeof torrentFiles.$inferSelect): TorrentEntryRecord {
  return { ...row, kind: row.kind as TorrentEntryRecord['kind'], media: row.media ?? null }
}

function toFile(row: typeof torrentFiles.$inferSelect): TorrentFileRecord {
  return toEntry(row) as TorrentFileRecord
}

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
      const root = torrentTreeRoot(input, input.files)
      const fileRows = input.files.map((file) => {
        const id = generateId()
        return {
          id,
          torrentId: row.id,
          kind: 'file',
          fileIdx: file.fileIdx,
          path: file.path,
          layoutPath: file.layoutPath ?? torrentTreeLayoutPath(root, file.path),
          size: file.size,
          mime: file.mime,
          storageId: input.storageId,
          objectKey: torrentEntryObjectKey(row.infoHash, id),
        }
      })
      // D1 caps one statement's bound parameters, so the file rows go in chunks.
      const fileInserts =
        fileRows.length > 0
          ? chunkBy(fileRows, rowsPerInsert(fileRows[0])).map((values) => db.insert(torrentFiles).values(values))
          : []
      await executeWriteTransaction(db, [db.insert(torrents).values(row), ...fileInserts])
      return (await get(row.id)) as TorrentRecord
    },

    get,

    async getByInfoHash(infoHash) {
      const rows = await db.select().from(torrents).where(eq(torrents.infoHash, infoHash.toLowerCase())).limit(1)
      return rows[0] ? toTorrent(rows[0]) : null
    },

    async listByInfoHashes(infoHashes) {
      const hashes = [...new Set(infoHashes.map((hash) => hash.toLowerCase()))]
      const rows = await Promise.all(
        chunks(hashes).map((batch) => db.select().from(torrents).where(inArray(torrents.infoHash, batch))),
      )
      return rows.flat().map(toTorrent)
    },

    async listFilesOf(torrentIds) {
      const ids = [...new Set(torrentIds)]
      const rows = await Promise.all(
        chunks(ids).map((batch) =>
          db
            .select()
            .from(torrentFiles)
            .where(and(inArray(torrentFiles.torrentId, batch), eq(torrentFiles.kind, 'file')))
            .orderBy(asc(torrentFiles.torrentId), asc(torrentFiles.fileIdx)),
        ),
      )
      return rows.flat().map(toFile)
    },

    async listWorkspaceReferences(orgId, torrent) {
      const range = torrentKeyRange(torrent.infoHash)
      return db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.storageId, torrent.storageId),
            gte(matters.object, range.from),
            lt(matters.object, range.to),
            eq(matters.orgId, orgId),
            eq(matters.status, ObjectStatus.ACTIVE),
            isNull(matters.trashedAt),
            isNull(matters.purgedAt),
          ),
        )
        .orderBy(desc(matters.createdAt), asc(matters.id))
    },

    async listFiles(torrentId): Promise<TorrentFileRecord[]> {
      const rows = await db
        .select()
        .from(torrentFiles)
        .where(and(eq(torrentFiles.torrentId, torrentId), eq(torrentFiles.kind, 'file')))
        .orderBy(asc(torrentFiles.fileIdx))
      return rows.map(toFile)
    },

    async listEntries(torrentId): Promise<TorrentEntryRecord[]> {
      const rows = await db
        .select()
        .from(torrentFiles)
        .where(eq(torrentFiles.torrentId, torrentId))
        .orderBy(asc(torrentFiles.layoutPath), asc(torrentFiles.id))
      return rows.map(toEntry)
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

    async findEntryByObject(storageId, objectKey) {
      const rows = await db
        .select()
        .from(torrentFiles)
        .where(and(eq(torrentFiles.storageId, storageId), eq(torrentFiles.objectKey, objectKey)))
        .limit(1)
      return rows[0] ? toEntry(rows[0]) : null
    },

    async findFolderEntry(torrentId, layoutPath) {
      const rows = await db
        .select()
        .from(torrentFiles)
        .where(
          and(
            eq(torrentFiles.torrentId, torrentId),
            eq(torrentFiles.kind, 'folder'),
            eq(torrentFiles.layoutPath, layoutPath),
          ),
        )
        .limit(1)
      return rows[0] ? toEntry(rows[0]) : null
    },

    async insertEntry(input) {
      const row = {
        id: input.id,
        torrentId: input.torrentId,
        kind: input.kind,
        fileIdx: null,
        path: null,
        layoutPath: input.layoutPath,
        size: input.size,
        mime: input.mime,
        storageId: input.storageId,
        objectKey: input.objectKey,
        media: input.media ?? null,
        uploadedAt: null,
      }
      await db.insert(torrentFiles).values(row)
      return toEntry(row)
    },

    async updateEntry(id, fields) {
      if (Object.keys(fields).length === 0) return
      await db.update(torrentFiles).set(fields).where(eq(torrentFiles.id, id))
    },

    async resetEntries(torrentId) {
      await executeWriteTransaction(db, [
        db
          .delete(torrentFiles)
          .where(and(eq(torrentFiles.torrentId, torrentId), inArray(torrentFiles.kind, ['sidecar', 'folder']))),
        db.update(torrentFiles).set({ uploadedAt: null, media: null }).where(eq(torrentFiles.torrentId, torrentId)),
      ])
    },

    async deleteEntry(id) {
      await db.delete(torrentFiles).where(and(eq(torrentFiles.id, id), sql`${torrentFiles.kind} <> 'file'`))
    },

    async deleteIncompleteSidecars(torrentId) {
      await db
        .delete(torrentFiles)
        .where(
          and(eq(torrentFiles.torrentId, torrentId), eq(torrentFiles.kind, 'sidecar'), isNull(torrentFiles.uploadedAt)),
        )
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

    async listForAdmin(opts) {
      const found = await db
        .select({ torrent: torrents, holders: holderCount, sourceDownloaderName: downloaders.name })
        .from(torrents)
        .leftJoin(downloaders, eq(downloaders.id, torrents.sourceDownloaderId))
        .where(afterCreatedAtId(torrents.createdAt, torrents.id, opts.after))
        .orderBy(desc(torrents.createdAt), desc(torrents.id))
        .limit(opts.pageSize + 1)
      const { rows, next } = keysetPage(found, opts.pageSize, (row) => ({
        createdAt: row.torrent.createdAt,
        id: row.torrent.id,
      }))
      const items: AdminTorrentRecord[] = rows.map((row) => ({
        ...toTorrent(row.torrent),
        holders: Number(row.holders),
        sourceDownloaderName: row.sourceDownloaderName ?? null,
      }))
      return { items, nextBoundary: next }
    },

    async countHolders(id) {
      const rows = await db.select({ holders: holderCount }).from(torrents).where(eq(torrents.id, id)).limit(1)
      return Number(rows[0]?.holders ?? 0)
    },
  }
  return repo
}

export function createStremThruLinkRepo(db: Database): StremThruLinkRepo {
  return {
    async get(userId, torrentFileId) {
      const rows = await db
        .select({ url: stremthruLinks.url, expiresAt: stremthruLinks.expiresAt })
        .from(stremthruLinks)
        .where(and(eq(stremthruLinks.userId, userId), eq(stremthruLinks.torrentFileId, torrentFileId)))
        .limit(1)
      return rows[0] ?? null
    },

    async save(input) {
      await db
        .insert(stremthruLinks)
        .values({
          id: generateId(),
          userId: input.userId,
          orgId: input.orgId,
          torrentFileId: input.torrentFileId,
          url: input.url,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        })
        .onConflictDoUpdate({
          target: [stremthruLinks.userId, stremthruLinks.torrentFileId],
          set: { orgId: input.orgId, url: input.url, expiresAt: input.expiresAt, createdAt: input.now },
        })
    },
  }
}
