import { DirType, ObjectStatus } from '@shared/constants'
import type { ActorType } from '@shared/schemas'
import { and, desc, eq, exists, gte, inArray, isNotNull, isNull, like, lt, not, or, type SQL, sql } from 'drizzle-orm'
import { type AnySQLiteColumn, alias } from 'drizzle-orm/sqlite-core'
import { generateId } from '../../../shared/ids'
import { backgroundJobs, matters, mediaLibraries } from '../../db/schema'
import { D1_MAX_BOUND_PARAMS, executeWriteTransaction } from '../../db/transaction'
import {
  joinMatterPath,
  MEDIA_LIBRARY_INDEX_FILE,
  MEDIA_LIBRARY_INDEX_MIME,
  MEDIA_LIBRARY_SCAN_LEASE_MS,
} from '../../domain/media-library'
import { chunk } from '../../lib/chunk'
import type { Database } from '../../platform/interface'
import type {
  MediaLibraryRecord,
  MediaLibraryRepo,
  MediaLibraryState,
  MediaLibrarySweepState,
  MediaLibraryView,
} from '../../usecases/ports'

type MediaLibraryRow = typeof mediaLibraries.$inferSelect

const MEDIA_LIBRARY_SCAN = 'media_library_scan'

function toRecord(row: MediaLibraryRow): MediaLibraryRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    folderId: row.folderId,
    fingerprint: row.fingerprint,
    lastScannedAt: row.lastScannedAt,
    createdByUserId: row.createdByUserId,
    createdBy: {
      type: row.createdByActorType as ActorType,
      ref: row.createdByActorRef,
      issuer: row.createdByActorIssuer,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

type StateRow = {
  library: MediaLibraryRow
  folderParent: string | null
  folderName: string | null
  folderTrashedAt: number | null
  scanning: number
}

function toState(row: StateRow): MediaLibraryState {
  return {
    ...toRecord(row.library),
    folder:
      row.folderName === null || row.folderParent === null
        ? null
        : {
            path: joinMatterPath(row.folderParent, row.folderName),
            name: row.folderName,
            trashed: row.folderTrashedAt !== null,
          },
    scanning: Boolean(row.scanning),
  }
}

// `parent` = path or starts with `path/`, as one range over the (org_id,
// parent) index instead of LIKE: folder names may contain % or _. '0' is the
// code point right after '/', so under SQLite's binary collation [path, path0)
// holds path, every string starting with `path/`, and siblings such as
// `path-2` that sort before `path/`; the residual test drops those siblings.
// Written as an OR of the two cases, SQLite gives up the range and scans the
// whole org once the path comes from a joined row. A caller paging through
// the subtree passes its keyset as the lower bound instead: SQLite takes only
// one lower bound for the index range, so keeping `parent >= path` beside it
// makes every page rescan from the start of the subtree.
function subtree(path: SQL, lowerBound: SQL = gte(matters.parent, path)): SQL {
  return and(
    lowerBound,
    lt(matters.parent, sql`${path} || '0'`),
    or(eq(matters.parent, path), gte(matters.parent, sql`${path} || '/'`)),
  ) as SQL
}

function notIndexFile(path: SQL): SQL {
  return not(and(eq(matters.parent, path), eq(matters.name, MEDIA_LIBRARY_INDEX_FILE)) as SQL)
}

function liveMatter(table: LiveColumns = matters): SQL {
  return and(eq(table.status, ObjectStatus.ACTIVE), isNull(table.trashedAt), isNull(table.purgedAt)) as SQL
}

type LiveColumns = { status: AnySQLiteColumn; trashedAt: AnySQLiteColumn; purgedAt: AnySQLiteColumn }

// The live subtree a fingerprint covers: everything under the library except its index.
function fingerprintedMatters(orgId: SQL | AnySQLiteColumn, path: SQL): SQL {
  return and(eq(matters.orgId, orgId), liveMatter(), subtree(path), notIndexFile(path)) as SQL
}

// Every write that changes what a scan sees moves one of these: create,
// copy, restore, and activation add a row; trash and purge drop one; rename,
// move, and overwrite bump updated_at (cascadeParentPath bumps every
// descendant of a moved folder). SUM(updated_at) also catches a change that
// lands in the same second as the previous maximum. COUNT(id) rather than
// COUNT(*) so a library joined to no rows counts zero.
const FINGERPRINT = sql<string>`COUNT(${matters.id}) || ':' || COALESCE(SUM(${matters.size}), 0) || ':' || COALESCE(MAX(${matters.updatedAt}), 0) || ':' || COALESCE(SUM(${matters.updatedAt}), 0)`

const folder = alias(matters, 'library_folder')
const indexFile = alias(matters, 'library_index')
const folderPath = sql`CASE WHEN ${folder.parent} = '' THEN ${folder.name} ELSE ${folder.parent} || '/' || ${folder.name} END`

export function createMediaLibraryRepo(db: Database): MediaLibraryRepo {
  function scanLeaseHeld(): SQL {
    return exists(
      db
        .select({ id: backgroundJobs.id })
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.orgId, mediaLibraries.orgId),
            eq(backgroundJobs.type, MEDIA_LIBRARY_SCAN),
            inArray(backgroundJobs.status, ['queued', 'running']),
            gte(backgroundJobs.updatedAt, new Date(Date.now() - MEDIA_LIBRARY_SCAN_LEASE_MS)),
            sql`json_extract(${backgroundJobs.metadata}, '$.libraryId') = ${mediaLibraries.id}`,
          ),
        ),
    )
  }

  function stateColumns() {
    return {
      library: mediaLibraries,
      folderParent: folder.parent,
      folderName: folder.name,
      folderTrashedAt: folder.trashedAt,
      scanning: sql<number>`${scanLeaseHeld()}`,
    }
  }

  const folderJoin = and(
    eq(folder.id, mediaLibraries.folderId),
    eq(folder.orgId, mediaLibraries.orgId),
    isNull(folder.purgedAt),
  )

  async function selectStates(where: SQL | undefined, limit?: number) {
    const query = db
      .select(stateColumns())
      .from(mediaLibraries)
      .leftJoin(folder, folderJoin)
      .where(where)
      .orderBy(desc(mediaLibraries.createdAt), desc(mediaLibraries.id))
    const rows = await (limit === undefined ? query : query.limit(limit))
    return rows.map(toState)
  }

  return {
    async create(input) {
      const now = new Date()
      const row: MediaLibraryRow = {
        id: generateId(),
        orgId: input.orgId,
        folderId: input.folderId,
        fingerprint: null,
        lastScannedAt: null,
        createdByUserId: input.createdByUserId,
        createdByActorType: input.createdBy.type,
        createdByActorRef: input.createdBy.ref,
        createdByActorIssuer: input.createdBy.issuer,
        createdAt: now,
        updatedAt: now,
      }
      const inserted = await db
        .insert(mediaLibraries)
        .values(row)
        .onConflictDoNothing()
        .returning({ id: mediaLibraries.id })
      return inserted.length > 0 ? toRecord(row) : null
    },

    async get(orgId, id) {
      const [state] = await selectStates(and(eq(mediaLibraries.orgId, orgId), eq(mediaLibraries.id, id)), 1)
      return state ?? null
    },

    async list(orgId, opts) {
      const after = opts.after
      const states = await selectStates(
        and(
          eq(mediaLibraries.orgId, orgId),
          isNotNull(folder.id),
          after
            ? or(
                lt(mediaLibraries.createdAt, after.createdAt),
                and(eq(mediaLibraries.createdAt, after.createdAt), lt(mediaLibraries.id, after.id)),
              )
            : undefined,
        ),
        opts.pageSize + 1,
      )
      const page = states.slice(0, opts.pageSize) as MediaLibraryView[]
      const last = page.at(-1)
      return {
        items: page,
        nextBoundary: states.length > opts.pageSize && last ? { createdAt: last.createdAt, id: last.id } : null,
      }
    },

    listByOrg(orgId) {
      return selectStates(eq(mediaLibraries.orgId, orgId))
    },

    // One grouped join for the whole instance: each library row joins the live
    // matters of its subtree, so the bound parameters stay constant however many
    // libraries there are.
    async listForSweep() {
      const indexed = exists(
        db
          .select({ id: indexFile.id })
          .from(indexFile)
          .where(
            and(
              eq(indexFile.orgId, mediaLibraries.orgId),
              eq(indexFile.parent, folderPath),
              eq(indexFile.name, MEDIA_LIBRARY_INDEX_FILE),
              eq(indexFile.dirtype, DirType.FILE),
              eq(indexFile.type, MEDIA_LIBRARY_INDEX_MIME),
              liveMatter(indexFile),
            ),
          ),
      )
      const rows = await db
        .select({ ...stateColumns(), indexed: sql<number>`${indexed}`, subtreeFingerprint: FINGERPRINT })
        .from(mediaLibraries)
        .leftJoin(folder, folderJoin)
        .leftJoin(matters, fingerprintedMatters(mediaLibraries.orgId, folderPath))
        .groupBy(mediaLibraries.id)
        .orderBy(desc(mediaLibraries.createdAt), desc(mediaLibraries.id))
      return rows.map(
        (row): MediaLibrarySweepState => ({
          ...toState(row),
          indexed: Boolean(row.indexed),
          subtreeFingerprint: row.subtreeFingerprint,
        }),
      )
    },

    async delete(orgId, id) {
      const deleted = await db
        .delete(mediaLibraries)
        .where(and(eq(mediaLibraries.orgId, orgId), eq(mediaLibraries.id, id)))
        .returning({ id: mediaLibraries.id })
      return deleted.length > 0
    },

    async deleteMany(ids) {
      await executeWriteTransaction(
        db,
        chunk(ids, D1_MAX_BOUND_PARAMS - 1).map((batch) =>
          db.delete(mediaLibraries).where(inArray(mediaLibraries.id, batch)),
        ),
      )
    },

    async recordScan(orgId, id, scan) {
      await db
        .update(mediaLibraries)
        .set({
          fingerprint: scan.fingerprint,
          ...(scan.scannedAt ? { lastScannedAt: scan.scannedAt } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(mediaLibraries.orgId, orgId), eq(mediaLibraries.id, id)))
    },

    async fingerprint(orgId, path) {
      const [row] = await db
        .select({ fingerprint: FINGERPRINT })
        .from(matters)
        .where(fingerprintedMatters(sql`${orgId}`, sql`${path}`))
      return row.fingerprint
    },

    // Keyset pages over matters_webdav_path_idx (org_id, parent, name), so
    // every page costs the same and binds the same parameters however large
    // the library is. (parent, name) is unique among live rows because
    // matters_active_name_uniq is unique on (org_id, parent, LOWER(name)).
    async listVideoFilesPage(orgId, folderPath, extensions, page) {
      const { after } = page
      const keyset = after ? sql`(${matters.parent}, ${matters.name}) > (${after.parent}, ${after.name})` : undefined
      return db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            liveMatter(),
            eq(matters.dirtype, DirType.FILE),
            subtree(sql`${folderPath}`, keyset),
            notIndexFile(sql`${folderPath}`),
            or(like(matters.type, 'video/%'), ...extensions.map((extension) => like(matters.name, `%.${extension}`))),
          ),
        )
        .orderBy(matters.parent, matters.name)
        .limit(page.limit)
    },
  }
}
