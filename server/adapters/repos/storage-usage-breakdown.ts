import { classifyStorageUsage, STORAGE_USAGE_CATEGORIES, type StorageUsageCategory } from '@shared/storage-usage'
import { and, asc, type Column, desc, eq, gt, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import { DirType } from '../../../shared/constants'
import { imageHostings, matters, storageUsageBreakdowns } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { StorageUsageBreakdownRepo, StorageUsageItemBoundary, StorageUsageProjection } from '../../usecases/ports'
import { keysetPage } from './keyset'

function matterCategoryExpression() {
  return sql<string>`CASE
    WHEN ${matters.trashedAt} IS NOT NULL THEN 'trash'
    WHEN lower(${matters.type}) LIKE 'image/%' THEN 'photos'
    WHEN lower(${matters.type}) LIKE 'video/%' THEN 'videos'
    WHEN lower(${matters.type}) LIKE 'audio/%' THEN 'music'
    WHEN lower(${matters.type}) LIKE 'text/%'
      OR lower(${matters.type}) IN (
        'application/epub+zip', 'application/msword', 'application/pdf', 'application/rtf',
        'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.oasis.opendocument.spreadsheet',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) THEN 'documents'
    WHEN lower(${matters.type}) IN (
      'application/gzip', 'application/vnd.rar', 'application/x-7z-compressed',
      'application/x-bzip2', 'application/x-rar-compressed', 'application/x-tar', 'application/zip'
    ) THEN 'archives'
    ELSE 'other'
  END`
}

function emptyBreakdowns(): Map<StorageUsageCategory, { bytes: number; fileCount: number }> {
  return new Map(STORAGE_USAGE_CATEGORIES.map((category) => [category, { bytes: 0, fileCount: 0 }]))
}

function wireBreakdowns(values: Map<StorageUsageCategory, { bytes: number; fileCount: number }>) {
  return STORAGE_USAGE_CATEGORIES.map((category) => ({
    category,
    ...(values.get(category) ?? { bytes: 0, fileCount: 0 }),
  }))
}

function itemCategoryCondition(category: StorageUsageCategory) {
  if (category === 'trash') return isNotNull(matters.trashedAt)
  const expression = matterCategoryExpression()
  return and(isNull(matters.trashedAt), sql`${expression} = ${category}`)
}

// `param` turns a boundary value back into the column's stored form.
type SortKey = { expr: SQL; param: (value: string | number) => string | number }

// Rows after the boundary in (sort key, id asc) order; the id breaks ties so the order is total.
function afterSortKey(
  key: SortKey,
  id: Column,
  dir: 'asc' | 'desc',
  after: StorageUsageItemBoundary | undefined,
): SQL | undefined {
  if (!after) return undefined
  const value = key.param(after.value)
  const beyond = dir === 'asc' ? gt(key.expr, value) : lt(key.expr, value)
  return or(beyond, and(eq(key.expr, value), gt(id, after.id)))
}

function joinPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name
}

function splitPath(path: string) {
  const separator = path.lastIndexOf('/')
  return separator === -1
    ? { name: path, parentPath: '' }
    : { name: path.slice(separator + 1), parentPath: path.slice(0, separator) }
}

export function initialStorageUsageProjectionQueries(db: Database, orgId: string, now: Date) {
  return STORAGE_USAGE_CATEGORIES.map((category) =>
    db
      .insert(storageUsageBreakdowns)
      .values({
        orgId,
        category,
        bytes: 0,
        fileCount: 0,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [storageUsageBreakdowns.orgId, storageUsageBreakdowns.category] }),
  )
}

export function createStorageUsageBreakdownRepo(db: Database): StorageUsageBreakdownRepo {
  return {
    async get(orgId): Promise<StorageUsageProjection> {
      const rows = await db.select().from(storageUsageBreakdowns).where(eq(storageUsageBreakdowns.orgId, orgId))
      const values = emptyBreakdowns()
      for (const row of rows) {
        if (!STORAGE_USAGE_CATEGORIES.includes(row.category as StorageUsageCategory)) continue
        values.set(row.category as StorageUsageCategory, { bytes: row.bytes, fileCount: row.fileCount })
      }
      return {
        updatedAt: rows.length > 0 ? new Date(Math.max(...rows.map((row) => row.updatedAt.getTime()))) : null,
        breakdowns: wireBreakdowns(values),
      }
    },

    async listItems(orgId, { category, pageSize, sortBy, sortDir, after }) {
      if (category === 'image_hosting') {
        const sortKey: SortKey =
          sortBy === 'name'
            ? { expr: sql`${imageHostings.path} COLLATE NOCASE`, param: (v) => String(v) }
            : sortBy === 'updatedAt'
              ? { expr: sql`${imageHostings.createdAt}`, param: Number }
              : { expr: sql`${imageHostings.size}`, param: Number }
        const found = await db
          .select()
          .from(imageHostings)
          .where(
            and(
              eq(imageHostings.orgId, orgId),
              eq(imageHostings.status, 'active'),
              isNull(imageHostings.purgedAt),
              afterSortKey(sortKey, imageHostings.id, sortDir, after),
            ),
          )
          .orderBy(sortDir === 'asc' ? asc(sortKey.expr) : desc(sortKey.expr), asc(imageHostings.id))
          .limit(pageSize + 1)
        const { rows, next } = keysetPage(found, pageSize, (row) => ({
          value: sortBy === 'name' ? row.path : sortBy === 'updatedAt' ? row.createdAt.getTime() : row.size,
          id: row.id,
        }))
        return {
          items: rows.map((row) => {
            const location = splitPath(row.path)
            return {
              id: row.id,
              name: location.name,
              path: row.path,
              parentPath: location.parentPath,
              type: row.mime,
              size: row.size,
              updatedAt: row.createdAt.toISOString(),
              source: 'image_hosting' as const,
            }
          }),
          nextBoundary: next,
        }
      }
      const sortKey: SortKey =
        sortBy === 'name'
          ? { expr: sql`${matters.name} COLLATE NOCASE`, param: (v) => String(v) }
          : sortBy === 'updatedAt'
            ? { expr: sql`${matters.updatedAt}`, param: (v) => Math.floor(Number(v) / 1000) }
            : { expr: sql`coalesce(${matters.size}, 0)`, param: Number }
      const found = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.orgId, orgId),
            eq(matters.status, 'active'),
            eq(matters.dirtype, DirType.FILE),
            isNull(matters.purgedAt),
            itemCategoryCondition(category),
            afterSortKey(sortKey, matters.id, sortDir, after),
          ),
        )
        .orderBy(sortDir === 'asc' ? asc(sortKey.expr) : desc(sortKey.expr), asc(matters.id))
        .limit(pageSize + 1)
      const { rows, next } = keysetPage(found, pageSize, (row) => ({
        value: sortBy === 'name' ? row.name : sortBy === 'updatedAt' ? row.updatedAt.getTime() : (row.size ?? 0),
        id: row.id,
      }))
      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          path: joinPath(row.parent, row.name),
          parentPath: row.parent,
          type: row.type,
          size: row.size ?? 0,
          updatedAt: row.updatedAt.toISOString(),
          source: category === 'trash' ? ('trash' as const) : ('files' as const),
        })),
        nextBoundary: next,
      }
    },
  }
}

export function storageCategoryForMime(mimeType: string): StorageUsageCategory {
  return classifyStorageUsage(mimeType)
}
