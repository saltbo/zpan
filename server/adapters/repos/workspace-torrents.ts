// Torrents lists (docs/design/torrents.md §3 workspace_torrents, §11).

import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { matters, torrents, workspaceTorrents } from '../../db/schema'
import { executeWriteTransactionWithResults } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type {
  StremThruHeldTorrent,
  TorrentRecord,
  WorkspaceTorrentRecord,
  WorkspaceTorrentRepo,
  WorkspaceTorrentView,
} from '../../usecases/ports'
import { afterCreatedAtId, keysetPage } from './keyset'

const EVICTABLE_STATUSES = ['ready', 'invalid'] as const
// D1 binds at most 100 parameters per statement.
const IN_CHUNK = 90

type EntryRow = typeof workspaceTorrents.$inferSelect
type TorrentRow = typeof torrents.$inferSelect

function toEntry(row: EntryRow): WorkspaceTorrentRecord {
  return {
    ...row,
    source: row.source as WorkspaceTorrentRecord['source'],
    status: row.status as WorkspaceTorrentRecord['status'],
  }
}

function toTorrent(row: TorrentRow): TorrentRecord {
  return {
    ...row,
    status: row.status as TorrentRecord['status'],
    verified: row.verified as TorrentRecord['verified'],
  }
}

function toView(row: { entry: EntryRow; torrent: TorrentRow | null }): WorkspaceTorrentView {
  return { ...toEntry(row.entry), torrent: row.torrent ? toTorrent(row.torrent) : null }
}

// Some drive file, in any status including trash, references the torrent.
const referencedByMatter = sql`EXISTS (
  SELECT 1 FROM ${matters}
  WHERE ${matters.storageId} = ${torrents.storageId}
    AND ${matters.object} >= 'bt/' || ${torrents.infoHash} || '/'
    AND ${matters.object} < 'bt/' || ${torrents.infoHash} || '0'
    AND ${matters.purgedAt} IS NULL
)`

// Some entry other than a stremthru one holds the torrent.
const heldByDownloadEntry = sql`EXISTS (
  SELECT 1 FROM ${workspaceTorrents}
  WHERE ${workspaceTorrents.torrentId} = ${torrents.id}
    AND ${workspaceTorrents.source} <> 'stremthru'
)`

// When the workspaces holding a torrent through stremthru entries last played it
// (an entry never played counts from when it was added). Written with qualified
// names, because drizzle drops the table from columns in a select list, which
// would bind them to the subquery's own table.
const lastPlayedOf = sql.raw(`(
  SELECT MAX(COALESCE("workspace_torrents"."last_played_at", "workspace_torrents"."created_at"))
  FROM "workspace_torrents"
  WHERE "workspace_torrents"."torrent_id" = "torrents"."id"
)`)

// The name shown for an entry, or its infoHash, contains the text.
function matchesSearch(search: string) {
  const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return sql`(
    LOWER(COALESCE(${torrents.name}, ${workspaceTorrents.displayName}, ${workspaceTorrents.sourceUri})) LIKE ${pattern} ESCAPE '\\'
    OR COALESCE(${torrents.infoHash}, ${workspaceTorrents.infoHash}) LIKE ${pattern} ESCAPE '\\'
  )`
}

const played = sql`COALESCE(${workspaceTorrents.lastPlayedAt}, ${workspaceTorrents.createdAt})`

export function createWorkspaceTorrentRepo(db: Database): WorkspaceTorrentRepo {
  function selectViews() {
    return db
      .select({ entry: workspaceTorrents, torrent: torrents })
      .from(workspaceTorrents)
      .leftJoin(torrents, eq(torrents.id, workspaceTorrents.torrentId))
  }

  return {
    async insert(input) {
      const infoHash = input.infoHash?.toLowerCase() ?? null
      // The entry the workspace already has for the torrent: the same torrent,
      // or (before the torrent reaches the instance) the same infoHash.
      async function held(): Promise<EntryRow | undefined> {
        const same = [
          input.torrentId ? eq(workspaceTorrents.torrentId, input.torrentId) : undefined,
          infoHash ? eq(workspaceTorrents.infoHash, infoHash) : undefined,
        ].filter((clause) => clause !== undefined)
        if (same.length === 0) return undefined
        const rows = await db
          .select()
          .from(workspaceTorrents)
          .where(and(eq(workspaceTorrents.orgId, input.orgId), or(...same)))
          .orderBy(asc(workspaceTorrents.createdAt))
          .limit(1)
        return rows[0]
      }
      const existing = await held()
      if (existing) return { created: false, entry: toEntry(existing) }
      const row: EntryRow = {
        id: generateId(),
        orgId: input.orgId,
        torrentId: input.torrentId,
        infoHash,
        source: input.source,
        sourceUri: input.sourceUri,
        displayName: input.displayName,
        taskId: input.taskId,
        status: input.status,
        error: input.error ?? null,
        createdByActorType: input.createdBy.type,
        createdByActorRef: input.createdBy.ref,
        createdByActorIssuer: input.createdBy.issuer,
        lastPlayedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }
      try {
        await db.insert(workspaceTorrents).values(row)
      } catch (error) {
        // A concurrent add of the same torrent won the unique (org_id,
        // torrent_id) or (org_id, info_hash).
        const winner = await held()
        if (!winner) throw error
        return { created: false, entry: toEntry(winner) }
      }
      return { created: true, entry: row as WorkspaceTorrentRecord }
    },

    async get(orgId, id) {
      const rows = await selectViews()
        .where(and(eq(workspaceTorrents.orgId, orgId), eq(workspaceTorrents.id, id)))
        .limit(1)
      return rows[0] ? toView(rows[0]) : null
    },

    async findByInfoHash(orgId, infoHash) {
      const rows = await db
        .select()
        .from(workspaceTorrents)
        .where(and(eq(workspaceTorrents.orgId, orgId), eq(workspaceTorrents.infoHash, infoHash.toLowerCase())))
        .orderBy(asc(workspaceTorrents.createdAt))
        .limit(1)
      return rows[0] ? toEntry(rows[0]) : null
    },

    async findBySourceUri(orgId, sourceUri) {
      const rows = await db
        .select()
        .from(workspaceTorrents)
        .where(and(eq(workspaceTorrents.orgId, orgId), eq(workspaceTorrents.sourceUri, sourceUri)))
        .orderBy(asc(workspaceTorrents.createdAt))
        .limit(1)
      return rows[0] ? toEntry(rows[0]) : null
    },

    async findByTask(taskId) {
      const rows = await db.select().from(workspaceTorrents).where(eq(workspaceTorrents.taskId, taskId)).limit(1)
      return rows[0] ? toEntry(rows[0]) : null
    },

    async list(orgId, opts) {
      const found = await selectViews()
        .where(
          and(
            eq(workspaceTorrents.orgId, orgId),
            afterCreatedAtId(workspaceTorrents.createdAt, workspaceTorrents.id, opts.after),
            opts.search ? matchesSearch(opts.search) : undefined,
          ),
        )
        .orderBy(desc(workspaceTorrents.createdAt), desc(workspaceTorrents.id))
        .limit(opts.pageSize + 1)
      const { rows, next } = keysetPage(found, opts.pageSize, (row) => ({
        createdAt: row.entry.createdAt,
        id: row.entry.id,
      }))
      return { items: rows.map(toView), nextBoundary: next }
    },

    async listByOffset(orgId, opts) {
      const [rows, totals] = await Promise.all([
        selectViews()
          .where(eq(workspaceTorrents.orgId, orgId))
          .orderBy(desc(workspaceTorrents.createdAt), desc(workspaceTorrents.id))
          .limit(opts.limit)
          .offset(opts.offset),
        db.select({ total: count() }).from(workspaceTorrents).where(eq(workspaceTorrents.orgId, orgId)),
      ])
      return { items: rows.map(toView), total: Number(totals[0]?.total ?? 0) }
    },

    async listByTorrent(torrentId) {
      const rows = await db.select().from(workspaceTorrents).where(eq(workspaceTorrents.torrentId, torrentId))
      return rows.map(toEntry)
    },

    async listWaiting(infoHash) {
      const rows = await db
        .select()
        .from(workspaceTorrents)
        .where(and(eq(workspaceTorrents.infoHash, infoHash.toLowerCase()), isNull(workspaceTorrents.torrentId)))
      return rows.map(toEntry)
    },

    async update(id, fields) {
      await db.update(workspaceTorrents).set(fields).where(eq(workspaceTorrents.id, id))
    },

    async delete(id) {
      await db.delete(workspaceTorrents).where(eq(workspaceTorrents.id, id))
    },

    async countByTorrent(torrentId) {
      const rows = await db
        .select({ total: count() })
        .from(workspaceTorrents)
        .where(eq(workspaceTorrents.torrentId, torrentId))
      return Number(rows[0]?.total ?? 0)
    },

    async expireStremThru(before, limit) {
      const stale = and(eq(workspaceTorrents.source, 'stremthru'), sql`${played} < ${before.getTime()}`)
      const found = await db
        .select({ id: workspaceTorrents.id })
        .from(workspaceTorrents)
        .where(stale)
        .orderBy(asc(played))
        .limit(limit)
      const expired: Array<{ id: string; torrentId: string | null }> = []
      for (let i = 0; i < found.length; i += IN_CHUNK) {
        const ids = found.slice(i, i + IN_CHUNK).map((row) => row.id)
        // Re-checked in the delete, so an entry played meanwhile stays.
        expired.push(
          ...(await db
            .delete(workspaceTorrents)
            .where(and(inArray(workspaceTorrents.id, ids), stale))
            .returning({ id: workspaceTorrents.id, torrentId: workspaceTorrents.torrentId })),
        )
      }
      return expired
    },

    async listStremThruHeld(limit) {
      const rows = await db
        .select({
          id: torrents.id,
          infoHash: torrents.infoHash,
          storageId: torrents.storageId,
          size: torrents.totalSize,
          lastAccessedAt: torrents.lastAccessedAt,
          lastPlayedAt: sql<number>`${lastPlayedOf}`.mapWith(Number),
        })
        .from(torrents)
        .where(
          and(
            inArray(torrents.status, [...EVICTABLE_STATUSES]),
            sql`NOT ${referencedByMatter}`,
            sql`NOT ${heldByDownloadEntry}`,
            sql`${lastPlayedOf} IS NOT NULL`,
          ),
        )
        .orderBy(asc(lastPlayedOf), asc(torrents.id))
        .limit(limit)
      return rows.map((row) => ({ ...row, lastPlayedAt: new Date(Number(row.lastPlayedAt)) }))
    },

    async claimStremThruHeldForEviction(candidate: StremThruHeldTorrent) {
      const claim = db
        .update(torrents)
        .set({ status: 'evicting', updatedAt: new Date() })
        .where(
          and(
            eq(torrents.id, candidate.id),
            inArray(torrents.status, [...EVICTABLE_STATUSES]),
            // Nobody touched it since it was ranked: a save to drive touches the
            // torrent before it inserts the drive rows that would hold it.
            eq(torrents.lastAccessedAt, candidate.lastAccessedAt),
            sql`NOT ${referencedByMatter}`,
            sql`NOT ${heldByDownloadEntry}`,
            // Nobody played or added it since it was ranked.
            sql`${lastPlayedOf} = ${candidate.lastPlayedAt.getTime()}`,
          ),
        )
        .returning({ id: torrents.id })
      const dropEntries = db
        .delete(workspaceTorrents)
        .where(
          and(
            eq(workspaceTorrents.torrentId, candidate.id),
            sql`EXISTS (SELECT 1 FROM ${torrents} WHERE ${torrents.id} = ${candidate.id} AND ${torrents.status} = 'evicting')`,
          ),
        )
      const [claimed] = (await executeWriteTransactionWithResults(db, [claim, dropEntries], [0])) as [
        Array<{ id: string }> | undefined,
      ]
      return (claimed?.length ?? 0) === 1
    },
  }
}
