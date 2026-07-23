import { sql } from 'drizzle-orm'
import { imageHostings, matters, storageUsageBreakdowns } from '../../db/schema'
import type { AtomicQuery } from '../../db/transaction'
import type { Database } from '../../platform/interface'

function placeholders(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
}

function matterCategory(forceActive = false) {
  return sql`CASE
    ${forceActive ? sql`` : sql`WHEN ${matters.trashedAt} IS NOT NULL THEN 'trash'`}
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

function matterDeltaQuery(
  db: Database,
  orgId: string,
  ids: string[],
  multiplier: 1 | -1,
  forceActive = false,
): AtomicQuery {
  const category = matterCategory(forceActive)
  const idList = placeholders(ids)
  return db
    .update(storageUsageBreakdowns)
    .set({
      bytes: sql`${storageUsageBreakdowns.bytes} + COALESCE((
        SELECT SUM(COALESCE(${matters.size}, 0)) * ${multiplier}
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.id} IN (${idList})
          AND ${matters.status} = 'active'
          AND ${matters.dirtype} = 0
          AND ${matters.purgedAt} IS NULL
          AND ${category} = ${storageUsageBreakdowns.category}
      ), 0)`,
      fileCount: sql`${storageUsageBreakdowns.fileCount} + COALESCE((
        SELECT COUNT(*) * ${multiplier}
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.id} IN (${idList})
          AND ${matters.status} = 'active'
          AND ${matters.dirtype} = 0
          AND ${matters.purgedAt} IS NULL
          AND ${category} = ${storageUsageBreakdowns.category}
      ), 0)`,
      updatedAt: new Date(),
    })
    .where(sql`${storageUsageBreakdowns.orgId} = ${orgId}`)
}

function trashDeltaQuery(db: Database, orgId: string, ids: string[], multiplier: 1 | -1): AtomicQuery {
  const idList = placeholders(ids)
  return db
    .update(storageUsageBreakdowns)
    .set({
      bytes: sql`${storageUsageBreakdowns.bytes} + COALESCE((
        SELECT SUM(COALESCE(${matters.size}, 0)) * ${multiplier}
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.id} IN (${idList})
          AND ${matters.status} = 'active'
          AND ${matters.dirtype} = 0
          AND ${matters.purgedAt} IS NULL
      ), 0)`,
      fileCount: sql`${storageUsageBreakdowns.fileCount} + COALESCE((
        SELECT COUNT(*) * ${multiplier}
        FROM ${matters}
        WHERE ${matters.orgId} = ${orgId}
          AND ${matters.id} IN (${idList})
          AND ${matters.status} = 'active'
          AND ${matters.dirtype} = 0
          AND ${matters.purgedAt} IS NULL
      ), 0)`,
      updatedAt: new Date(),
    })
    .where(
      sql`${storageUsageBreakdowns.orgId} = ${orgId}
        AND ${storageUsageBreakdowns.category} = 'trash'`,
    )
}

function imageDeltaQuery(db: Database, orgId: string, id: string, multiplier: 1 | -1): AtomicQuery {
  return db
    .update(storageUsageBreakdowns)
    .set({
      bytes: sql`${storageUsageBreakdowns.bytes} + COALESCE((
        SELECT ${imageHostings.size} * ${multiplier}
        FROM ${imageHostings}
        WHERE ${imageHostings.id} = ${id}
          AND ${imageHostings.orgId} = ${orgId}
          AND ${imageHostings.status} = 'active'
          AND ${imageHostings.purgedAt} IS NULL
      ), 0)`,
      fileCount: sql`${storageUsageBreakdowns.fileCount} + CASE WHEN EXISTS (
        SELECT 1 FROM ${imageHostings}
        WHERE ${imageHostings.id} = ${id}
          AND ${imageHostings.orgId} = ${orgId}
          AND ${imageHostings.status} = 'active'
          AND ${imageHostings.purgedAt} IS NULL
      ) THEN ${multiplier} ELSE 0 END`,
      updatedAt: new Date(),
    })
    .where(
      sql`${storageUsageBreakdowns.orgId} = ${orgId}
        AND ${storageUsageBreakdowns.category} = 'image_hosting'`,
    )
}

function chunks(ids: string[]): string[][] {
  const result: string[][] = []
  for (let index = 0; index < ids.length; index += 40) result.push(ids.slice(index, index + 40))
  return result
}

export function matterAddedProjectionQueries(db: Database, orgId: string, id: string): AtomicQuery[] {
  return [matterDeltaQuery(db, orgId, [id], 1)]
}

export function matterRemovedProjectionQueries(db: Database, orgId: string, ids: string[]): AtomicQuery[] {
  return chunks(ids).map((chunk) => matterDeltaQuery(db, orgId, chunk, -1))
}

export function matterTrashedProjectionQueries(db: Database, orgId: string, ids: string[]): AtomicQuery[] {
  return chunks(ids).flatMap((chunk) => [matterDeltaQuery(db, orgId, chunk, -1), trashDeltaQuery(db, orgId, chunk, 1)])
}

export function matterRestoredProjectionQueries(db: Database, orgId: string, ids: string[]): AtomicQuery[] {
  return chunks(ids).flatMap((chunk) => [
    trashDeltaQuery(db, orgId, chunk, -1),
    matterDeltaQuery(db, orgId, chunk, 1, true),
  ])
}

export function imageAddedProjectionQueries(db: Database, orgId: string, id: string): AtomicQuery[] {
  return [imageDeltaQuery(db, orgId, id, 1)]
}

export function imageRemovedProjectionQueries(db: Database, orgId: string, id: string): AtomicQuery[] {
  return [imageDeltaQuery(db, orgId, id, -1)]
}
