import { and, eq, like, or } from 'drizzle-orm'
import { DirType } from '../../shared/constants'
import type { Storage as S3StorageType } from '../../shared/types'
import { matters, orgQuotas, shareRecipients, shares } from '../db/schema'
import type { Database } from '../platform/interface'
import { recordActivity } from './activity'
import type { Matter } from './matter'
import { createMatter, incrementUsageIfAllowed } from './matter'
import { buildObjectKey } from './path-template'
import { S3Service } from './s3'
import type { Share, ShareRecipient } from './share'
import { getStorage, selectStorage } from './storage'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShareResolution =
  | { status: 'ok'; share: Share; matter: Matter; recipients: ShareRecipient[] }
  | { status: 'not_found' | 'revoked' | 'matter_trashed' }

export interface SaveShareInput {
  share: Share
  matter: Matter
  currentUserId: string
  targetOrgId: string
  targetParent: string
}

export interface SaveShareResult {
  saved: Matter[]
  skipped: Array<{ name: string; reason: string }>
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const s3 = new S3Service()

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

async function getDirectActiveChildren(db: Database, orgId: string, folderPath: string): Promise<Matter[]> {
  return db
    .select()
    .from(matters)
    .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath), eq(matters.status, 'active')))
}

// ─── Share resolution ─────────────────────────────────────────────────────────

export async function resolveShareByToken(db: Database, token: string): Promise<ShareResolution> {
  const rows = await db
    .select({ share: shares, matter: matters })
    .from(shares)
    .innerJoin(matters, eq(shares.matterId, matters.id))
    .where(eq(shares.token, token))

  const row = rows[0]
  if (!row) return { status: 'not_found' }
  if (row.share.status === 'revoked') return { status: 'revoked' }
  if (row.matter.status === 'trashed') return { status: 'matter_trashed' }

  const recipientRows = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, row.share.id))

  return { status: 'ok', share: row.share, matter: row.matter, recipients: recipientRows }
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
  if (bytes <= 0) return true
  const rows = await db
    .select({ quota: orgQuotas.quota, used: orgQuotas.used })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
  const row = rows[0]
  if (!row || row.quota === 0) return true
  return row.used + bytes <= row.quota
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
  shareId: string,
): Promise<Matter> {
  const bytes = sourceMatter.size ?? 0

  if (bytes > 0) {
    const allowed = await incrementUsageIfAllowed(db, targetOrgId, targetStorage.id, bytes)
    if (!allowed) throw new Error('QUOTA_EXCEEDED')
  }

  const dstKey = buildObjectKey({ uid: currentUserId, orgId: targetOrgId, rawExt: fileExt(sourceMatter.name) })

  if (sourceStorage.id === targetStorage.id) {
    await s3.copyObject(sourceStorage, sourceMatter.object, targetStorage, dstKey)
  } else {
    await s3.streamCopy(sourceStorage, sourceMatter.object, targetStorage, dstKey)
  }

  const newMatter = await createMatter(db, {
    orgId: targetOrgId,
    name: sourceMatter.name,
    type: sourceMatter.type,
    size: bytes ?? undefined,
    dirtype: DirType.FILE,
    parent: targetParent,
    object: dstKey,
    storageId: targetStorage.id,
    status: 'active',
    onConflict: 'rename',
  })

  await recordActivity(db, {
    orgId: targetOrgId,
    userId: currentUserId,
    action: 'save_from_share',
    targetType: 'file',
    targetId: newMatter.id,
    targetName: newMatter.name,
    metadata: { sourceShareId: shareId },
  })

  return newMatter
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
  shareId: string,
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
            shareId,
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

export async function saveShareToDrive(db: Database, input: SaveShareInput): Promise<SaveShareResult> {
  const { share, matter: sourceMatter, currentUserId, targetOrgId, targetParent } = input

  const sourceStorage = await getStorage(db, sourceMatter.storageId)
  if (!sourceStorage) throw new Error('Source storage not found')

  const targetStorage = await selectStorage(db, 'private')

  const src = sourceStorage as unknown as S3StorageType
  const dst = targetStorage as unknown as S3StorageType

  if (sourceMatter.dirtype === DirType.FILE) {
    const newMatter = await saveFile(db, sourceMatter, src, dst, currentUserId, targetOrgId, targetParent, share.id)
    return { saved: [newMatter], skipped: [] }
  }

  return saveFolderRecursive(db, sourceMatter, src, dst, currentUserId, targetOrgId, targetParent, share.id)
}
