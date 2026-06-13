import { DirType } from '@shared/constants'
import { buildObjectKey, fileExt } from '../lib/path-template'
import type { Database } from '../platform/interface'
import { createMatter, type Matter } from '../services/matter'
import type {
  ActivityRepo,
  QuotaRepo,
  S3Gateway,
  ShareMatterRow,
  ShareRepo,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
} from './ports'
import { withStorageUsageReservation } from './storage-usage'

// Pure orchestration: copies a shared matter (file or folder) into another org,
// reserving target-org quota per file via withStorageUsageReservation. Reaches
// the outside world only through deps; matter creation is the (still-unmigrated)
// matter service, imported transitionally.

export type SaveToDriveDeps = {
  s3: S3Gateway
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  quota: QuotaRepo
  activity: ActivityRepo
  share: ShareRepo
}

export interface SaveShareInput {
  share: { id: string }
  matter: ShareMatterRow
  currentUserId: string
  targetOrgId: string
  targetParent: string
  teamQuotaEnabled?: boolean
}

export interface SaveShareResult {
  saved: Matter[]
  skipped: Array<{ name: string; reason: string }>
}

interface CopyActivity {
  action: string
  metadata: Record<string, unknown>
}

export interface CopyMatterToOrgInput {
  sourceMatter: ShareMatterRow
  currentUserId: string
  targetOrgId: string
  targetParent: string
  activity: CopyActivity
  teamQuotaEnabled?: boolean
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

async function saveFile(
  deps: SaveToDriveDeps,
  db: Database,
  sourceMatter: ShareMatterRow,
  sourceStorage: StorageRecord,
  targetStorage: StorageRecord,
  currentUserId: string,
  targetOrgId: string,
  targetParent: string,
  activity: CopyActivity,
  teamQuotaEnabled = true,
): Promise<Matter> {
  const bytes = sourceMatter.size ?? 0
  const dstKey = buildObjectKey({ uid: currentUserId, orgId: targetOrgId, rawExt: fileExt(sourceMatter.name) })

  return withStorageUsageReservation(
    { quota: deps.quota, storageUsage: deps.storageUsage },
    { orgId: targetOrgId, storageId: targetStorage.id, bytes, teamQuotaEnabled },
    async (ctx) => {
      if (sourceStorage.id === targetStorage.id) {
        await deps.s3.copyObject(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      } else {
        await deps.s3.streamCopy(sourceStorage, sourceMatter.object, targetStorage, dstKey)
      }
      ctx.onRollback(() => deps.s3.deleteObject(targetStorage, dstKey))

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

      await deps.activity.record({
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

async function saveFolderRecursive(
  deps: SaveToDriveDeps,
  db: Database,
  sourceFolderMatter: ShareMatterRow,
  sourceStorage: StorageRecord,
  targetStorage: StorageRecord,
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

  const queue: Array<{ sourcePath: string; targetPath: string }> = [
    { sourcePath: sourceRootPath, targetPath: targetRootPath },
  ]

  while (queue.length > 0) {
    const { sourcePath, targetPath } = queue.shift()!
    const children = await deps.share.listDirectActiveChildren(sourceFolderMatter.orgId, sourcePath)

    for (const child of children) {
      if (child.dirtype === DirType.FILE) {
        try {
          const newFile = await saveFile(
            deps,
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

// Copy a file or folder (recursively) into another org. Quota is reserved in the
// target org per file; files that fail (e.g. quota) are reported in `skipped`
// rather than failing the whole operation.
export async function copyMatterToOrg(
  deps: SaveToDriveDeps,
  db: Database,
  input: CopyMatterToOrgInput,
): Promise<SaveShareResult> {
  const { sourceMatter, currentUserId, targetOrgId, targetParent, activity, teamQuotaEnabled = true } = input

  const sourceStorage = await deps.storages.get(sourceMatter.storageId)
  if (!sourceStorage) throw new Error('Source storage not found')

  const targetStorage = await deps.storages.select('private')

  if (sourceMatter.dirtype === DirType.FILE) {
    const newMatter = await saveFile(
      deps,
      db,
      sourceMatter,
      sourceStorage,
      targetStorage,
      currentUserId,
      targetOrgId,
      targetParent,
      activity,
      teamQuotaEnabled,
    )
    return { saved: [newMatter], skipped: [] }
  }

  return saveFolderRecursive(
    deps,
    db,
    sourceMatter,
    sourceStorage,
    targetStorage,
    currentUserId,
    targetOrgId,
    targetParent,
    activity,
    teamQuotaEnabled,
  )
}

export async function saveShareToDrive(
  deps: SaveToDriveDeps,
  db: Database,
  input: SaveShareInput,
): Promise<SaveShareResult> {
  const { share, matter: sourceMatter, ...rest } = input
  return copyMatterToOrg(deps, db, {
    ...rest,
    sourceMatter,
    activity: { action: 'save_from_share', metadata: { sourceShareId: share.id } },
  })
}
