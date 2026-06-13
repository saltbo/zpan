import { and, eq, like, or } from 'drizzle-orm'
import { DirType } from '../../shared/constants'
import { createActivityRepo } from '../adapters/repos/activity'
import { createQuotaRepo } from '../adapters/repos/quota'
import { createStorageRepo } from '../adapters/repos/storage'
import { createStorageUsageRepo } from '../adapters/repos/storage-usage'
import { matters } from '../db/schema'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Database } from '../platform/interface'
import type { StorageRecord as S3StorageType } from '../usecases/ports'
import { withStorageUsageReservation } from '../usecases/storage-usage'
import type { Matter } from './matter'
import { createMatter } from './matter'
import { S3Service } from './s3'
import type { Share, ShareResolution } from './share'

// ─── Types ────────────────────────────────────────────────────────────────────

export type { ShareResolution }

export interface SaveShareInput {
  share: Share
  matter: Matter
  currentUserId: string
  targetOrgId: string
  targetParent: string
  teamQuotaEnabled?: boolean
}

export interface SaveShareResult {
  saved: Matter[]
  skipped: Array<{ name: string; reason: string }>
}

// Activity log entry recorded in the target org for each copied file.
interface CopyActivity {
  action: string
  metadata: Record<string, unknown>
}

export interface CopyMatterToOrgInput {
  sourceMatter: Matter
  currentUserId: string
  targetOrgId: string
  targetParent: string
  activity: CopyActivity
  teamQuotaEnabled?: boolean
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const s3 = new S3Service()

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

async function getDirectActiveChildren(db: Database, orgId: string, folderPath: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath), eq(matters.status, 'active')))
}

// ─── Quota helpers ────────────────────────────────────────────────────────────

export async function computeSourceBytes(db: Database, matter: Matter): Promise<number> {
  if (matter.dirtype === DirType.FILE) return matter.size ?? 0

  const folderPath = buildPath(matter.parent, matter.name)
  const rows = await db
    .select({ size: matters.size })
    .from(matters)
    .where(
      and(
        eq(matters.orgId, matter.orgId),
        eq(matters.status, 'active'),
        eq(matters.dirtype, DirType.FILE),
        or(eq(matters.parent, folderPath), like(matters.parent, `${folderPath}/%`)),
      ),
    )
  return rows.reduce((acc, r) => acc + (r.size ?? 0), 0)
}

export async function isQuotaSufficient(db: Database, orgId: string, bytes: number): Promise<boolean> {
  return createQuotaRepo(db).hasQuotaForBytes(orgId, bytes)
}

// ─── File copy ────────────────────────────────────────────────────────────────

async function saveFile(
  db: Database,
  sourceMatter: Matter,
  sourceStorage: S3StorageType,
  targetStorage: S3StorageType,
  currentUserId: string,
  targetOrgId: string,
  targetParent: string,
  activity: CopyActivity,
  teamQuotaEnabled = true,
): Promise<Matter> {
  const bytes = sourceMatter.size ?? 0

  const dstKey = buildObjectKey({ uid: currentUserId, orgId: targetOrgId, rawExt: fileExt(sourceMatter.name) })

  return withStorageUsageReservation(
    { quota: createQuotaRepo(db), storageUsage: createStorageUsageRepo(db) },
    { orgId: targetOrgId, storageId: targetStorage.id, bytes, teamQuotaEnabled },
    async (ctx) => {
      if (sourceStorage.id === targetStorage.id) {
        await s3.copyObject(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      } else {
        await s3.streamCopy(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      }
      ctx.onRollback(() => s3.deleteObject(targetStorage, dstKey))

      const newMatter = await createMatter(db, {
        orgId: targetOrgId,
        name: sourceMatter.name,
        type: sourceMatter.type,
        size: bytes,
        dirtype: DirType.FILE,
        parent: targetParent,
        object: dstKey,
        storageId: targetStorage.id,
        status: 'active',
        onConflict: 'rename',
      })

      await createActivityRepo(db).record({
        orgId: targetOrgId,
        userId: currentUserId,
        action: activity.action,
        targetType: 'file',
        targetId: newMatter.id,
        targetName: newMatter.name,
        metadata: activity.metadata,
      })

      return newMatter
    },
  )
}

// ─── Folder recursive copy ────────────────────────────────────────────────────

async function saveFolderRecursive(
  db: Database,
  sourceFolderMatter: Matter,
  sourceStorage: S3StorageType,
  targetStorage: S3StorageType,
  currentUserId: string,
  targetOrgId: string,
  targetParent: string,
  activity: CopyActivity,
  teamQuotaEnabled = true,
): Promise<SaveShareResult> {
  const saved: Matter[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  const rootFolder = await createMatter(db, {
    orgId: targetOrgId,
    name: sourceFolderMatter.name,
    type: 'folder',
    size: 0,
    dirtype: sourceFolderMatter.dirtype ?? undefined,
    parent: targetParent,
    object: '',
    storageId: targetStorage.id,
    status: 'active',
    onConflict: 'rename',
  })
  saved.push(rootFolder)

  const sourceRootPath = buildPath(sourceFolderMatter.parent, sourceFolderMatter.name)
  const targetRootPath = buildPath(targetParent, rootFolder.name)

  // BFS: pairs of (source folder path, target folder path)
  const queue: Array<{ sourcePath: string; targetPath: string }> = [
    { sourcePath: sourceRootPath, targetPath: targetRootPath },
  ]

  while (queue.length > 0) {
    const { sourcePath, targetPath } = queue.shift()!
    const children = await getDirectActiveChildren(db, sourceFolderMatter.orgId, sourcePath)

    for (const child of children) {
      if (child.dirtype === DirType.FILE) {
        try {
          const newFile = await saveFile(
            db,
            child,
            sourceStorage,
            targetStorage,
            currentUserId,
            targetOrgId,
            targetPath,
            activity,
            teamQuotaEnabled,
          )
          saved.push(newFile)
        } catch (e) {
          skipped.push({ name: child.name, reason: (e as Error).message })
        }
      } else {
        const newFolder = await createMatter(db, {
          orgId: targetOrgId,
          name: child.name,
          type: 'folder',
          size: 0,
          dirtype: child.dirtype ?? undefined,
          parent: targetPath,
          object: '',
          storageId: targetStorage.id,
          status: 'active',
          onConflict: 'rename',
        })
        saved.push(newFolder)
        queue.push({
          sourcePath: buildPath(child.parent, child.name),
          targetPath: buildPath(targetPath, newFolder.name),
        })
      }
    }
  }

  return { saved, skipped }
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Copy a file or folder (recursively) into another org. Quota is reserved in
// the target org per file; files that fail (e.g. quota) are reported in
// `skipped` rather than failing the whole operation.
export async function copyMatterToOrg(db: Database, input: CopyMatterToOrgInput): Promise<SaveShareResult> {
  const { sourceMatter, currentUserId, targetOrgId, targetParent, activity, teamQuotaEnabled = true } = input

  const sourceStorage = await createStorageRepo(db).get(sourceMatter.storageId)
  if (!sourceStorage) throw new Error('Source storage not found')

  const targetStorage = await createStorageRepo(db).select('private')

  const src = sourceStorage
  const dst = targetStorage

  if (sourceMatter.dirtype === DirType.FILE) {
    const newMatter = await saveFile(
      db,
      sourceMatter,
      src,
      dst,
      currentUserId,
      targetOrgId,
      targetParent,
      activity,
      teamQuotaEnabled,
    )
    return { saved: [newMatter], skipped: [] }
  }

  return saveFolderRecursive(
    db,
    sourceMatter,
    src,
    dst,
    currentUserId,
    targetOrgId,
    targetParent,
    activity,
    teamQuotaEnabled,
  )
}

export async function saveShareToDrive(db: Database, input: SaveShareInput): Promise<SaveShareResult> {
  const { share, matter: sourceMatter, ...rest } = input
  return copyMatterToOrg(db, {
    ...rest,
    sourceMatter,
    activity: { action: 'save_from_share', metadata: { sourceShareId: share.id } },
  })
}
