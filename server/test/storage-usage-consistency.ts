import {
  classifyStorageUsage,
  STORAGE_USAGE_CATEGORIES,
  type StorageUsageBreakdown,
  type StorageUsageCategory,
} from '@shared/storage-usage'
import { and, eq, isNull } from 'drizzle-orm'
import { expect } from 'vitest'
import { DirType, ObjectStatus } from '../../shared/constants'
import { imageHostings, matters, storageUsageBreakdowns } from '../db/schema'
import type { Database } from '../platform/interface'

function emptyBreakdowns(): Map<StorageUsageCategory, StorageUsageBreakdown> {
  return new Map(
    STORAGE_USAGE_CATEGORIES.map((category) => [
      category,
      {
        category,
        bytes: 0,
        fileCount: 0,
      },
    ]),
  )
}

function add(
  breakdowns: Map<StorageUsageCategory, StorageUsageBreakdown>,
  category: StorageUsageCategory,
  bytes: number,
): void {
  const value = breakdowns.get(category)
  if (!value) throw new Error(`storage_usage_test_unknown_category:${category}`)
  value.bytes += bytes
  value.fileCount += 1
}

function ordered(breakdowns: Map<StorageUsageCategory, StorageUsageBreakdown>): StorageUsageBreakdown[] {
  return STORAGE_USAGE_CATEGORIES.map((category) => breakdowns.get(category) as StorageUsageBreakdown)
}

export async function calculateExpectedStorageUsage(db: Database, orgId: string): Promise<StorageUsageBreakdown[]> {
  const [matterRows, imageRows] = await Promise.all([
    db
      .select({
        type: matters.type,
        size: matters.size,
        trashedAt: matters.trashedAt,
      })
      .from(matters)
      .where(
        and(
          eq(matters.orgId, orgId),
          eq(matters.status, ObjectStatus.ACTIVE),
          eq(matters.dirtype, DirType.FILE),
          isNull(matters.purgedAt),
        ),
      ),
    db
      .select({ size: imageHostings.size })
      .from(imageHostings)
      .where(and(eq(imageHostings.orgId, orgId), eq(imageHostings.status, 'active'), isNull(imageHostings.purgedAt))),
  ])
  const breakdowns = emptyBreakdowns()
  for (const row of matterRows) {
    const category = row.trashedAt === null ? classifyStorageUsage(row.type) : 'trash'
    add(breakdowns, category, row.size ?? 0)
  }
  for (const row of imageRows) add(breakdowns, 'image_hosting', row.size)
  return ordered(breakdowns)
}

export async function expectStorageUsageConsistent(db: Database, orgId: string, context: string): Promise<void> {
  const [expected, rows] = await Promise.all([
    calculateExpectedStorageUsage(db, orgId),
    db
      .select({
        category: storageUsageBreakdowns.category,
        bytes: storageUsageBreakdowns.bytes,
        fileCount: storageUsageBreakdowns.fileCount,
      })
      .from(storageUsageBreakdowns)
      .where(eq(storageUsageBreakdowns.orgId, orgId)),
  ])
  const actual = emptyBreakdowns()
  for (const row of rows) {
    if (!STORAGE_USAGE_CATEGORIES.includes(row.category as StorageUsageCategory)) continue
    actual.set(row.category as StorageUsageCategory, {
      category: row.category as StorageUsageCategory,
      bytes: row.bytes,
      fileCount: row.fileCount,
    })
  }
  expect(ordered(actual), context).toEqual(expected)
}
