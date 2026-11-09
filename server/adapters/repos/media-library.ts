import { DirType, ObjectStatus } from '@shared/constants'
import type { ActorType } from '@shared/schemas'
import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  not,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { backgroundJobs, matters, mediaLibraries } from '../../db/schema'
import { joinMatterPath, MEDIA_LIBRARY_INDEX_FILE, MEDIA_LIBRARY_SCAN_LEASE_MS } from '../../domain/media-library'
import type { Database } from '../../platform/interface'
import type { MediaLibraryRecord, MediaLibraryRepo, MediaLibraryState, MediaLibraryView } from '../../usecases/ports'

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

// `parent` = path or starts with `path/`. The prefix test is a range over the
// (org_id, parent) index instead of LIKE: folder names may contain % or _, and
// '0' is the code point right after '/', so [path/, path0) holds exactly the
// strings that start with `path/` under SQLite's binary collation.
function subtree(path: string): SQL {
  return or(eq(matters.parent, path), and(gte(matters.parent, `${path}/`), lt(matters.parent, `${path}0`))) as SQL
}

function notIndexFile(path: string): SQL {
  return not(and(eq(matters.parent, path), eq(matters.name, MEDIA_LIBRARY_INDEX_FILE)) as SQL)
}

function liveMatter(): SQL {
  return and(eq(matters.status, ObjectStatus.ACTIVE), isNull(matters.trashedAt), isNull(matters.purgedAt)) as SQL
}

export function createMediaLibraryRepo(db: Database): MediaLibraryRepo {
  async function selectStates(where: SQL | undefined, limit?: number) {
    const scanning = exists(
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
    const query = db
      .select({
        library: mediaLibraries,
        folderParent: matters.parent,
        folderName: matters.name,
        folderTrashedAt: matters.trashedAt,
        scanning: sql<number>`${scanning}`,
      })
      .from(mediaLibraries)
      .leftJoin(
        matters,
        and(eq(matters.id, mediaLibraries.folderId), eq(matters.orgId, mediaLibraries.orgId), isNull(matters.purgedAt)),
      )
      .where(where)
      .orderBy(desc(mediaLibraries.createdAt), desc(mediaLibraries.id))
    const rows = await (limit === undefined ? query : query.limit(limit))
    return rows.map(
      (row): MediaLibraryState => ({
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
      }),
    )
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
          isNotNull(matters.id),
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

    listAll() {
      return selectStates(undefined)
    },

    async delete(orgId, id) {
      const deleted = await db
        .delete(mediaLibraries)
        .where(and(eq(mediaLibraries.orgId, orgId), eq(mediaLibraries.id, id)))
        .returning({ id: mediaLibraries.id })
      return deleted.length > 0
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

    // Every write that changes what a scan sees moves one of these: create,
    // copy, restore, and activation add a row; trash and purge drop one; rename,
    // move, and overwrite bump updated_at (cascadeParentPath bumps every
    // descendant of a moved folder). SUM(updated_at) also catches a change that
    // lands in the same second as the previous maximum.
    async fingerprint(orgId, folderPath) {
      const [row] = await db
        .select({
          count: count(),
          bytes: sql<number>`COALESCE(SUM(${matters.size}), 0)`,
          latest: sql<number>`COALESCE(MAX(${matters.updatedAt}), 0)`,
          total: sql<number>`COALESCE(SUM(${matters.updatedAt}), 0)`,
        })
        .from(matters)
        .where(and(eq(matters.orgId, orgId), liveMatter(), subtree(folderPath), notIndexFile(folderPath)))
      return `${row.count}:${row.bytes}:${row.latest}:${row.total}`
    },

    async listVideoFiles(orgId, folderPath, extensions) {
      return db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            liveMatter(),
            eq(matters.dirtype, DirType.FILE),
            subtree(folderPath),
            notIndexFile(folderPath),
            or(like(matters.type, 'video/%'), ...extensions.map((extension) => like(matters.name, `%.${extension}`))),
          ),
        )
    },
  }
}
