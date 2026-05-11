import type { CreateBackgroundJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import { DirType } from '../../shared/constants'
import type { Storage as S3StorageType } from '../../shared/types'
import { matters } from '../db/schema'
import type { Database } from '../platform/interface'
import { createBackgroundJob, updateBackgroundJob } from './background-jobs'
import { createMatter, decrementUsage, getMatter, incrementUsageIfAllowed, purgeMatters } from './matter'
import { buildObjectKey } from './path-template'
import { S3Service } from './s3'
import { getStorage, selectStorage } from './storage'
import { collectCompressionPlan, createZipArchive } from './zip-compress'
import { validateAndExtractZip } from './zip-extract'

export interface CreateArchiveJobInput {
  orgId: string
  userId: string
  request: CreateBackgroundJobRequest
  s3?: S3Service
}

const ZIP_MIME = 'application/zip'
const DEFAULT_FILE_MIME = 'application/octet-stream'

export async function createArchiveJob(db: Database, input: CreateArchiveJobInput): Promise<BackgroundJob> {
  const targetFolder = input.request.targetFolder ?? null
  const job = await createBackgroundJob(db, {
    orgId: input.orgId,
    userId: input.userId,
    type: input.request.type,
    targetFolder,
    metadata: input.request,
    cancelable: false,
  })

  const s3 = input.s3 ?? new S3Service()
  try {
    await updateBackgroundJob(db, input.orgId, job.id, { status: 'running', startedAt: new Date() })
    if (input.request.type === 'archive_compress') {
      return await runCompressionJob(db, s3, job.id, input.orgId, input.userId, input.request)
    }
    return await runExtractionJob(db, s3, job.id, input.orgId, input.userId, input.request)
  } catch (error) {
    return updateBackgroundJob(db, input.orgId, job.id, {
      status: 'failed',
      errorMessage: (error as Error).message,
      retryable: false,
      cancelable: false,
    })
  }
}

async function runCompressionJob(
  db: Database,
  s3: S3Service,
  jobId: string,
  orgId: string,
  userId: string,
  request: Extract<CreateBackgroundJobRequest, { type: 'archive_compress' }>,
): Promise<BackgroundJob> {
  if (request.targetFolder !== undefined) await requireTargetFolder(db, orgId, request.targetFolder)
  const plan = await collectCompressionPlan(db, orgId, request.matterIds, {
    targetFolder: request.targetFolder,
    outputName: request.outputName,
  })
  await updateBackgroundJob(db, orgId, jobId, {
    progress: { inputBytes: plan.inputBytes, fileCount: plan.files.length },
  })

  const objects = []
  for (const file of plan.files) {
    const storage = await requireStorage(db, file.matter.storageId)
    objects.push({ archivePath: file.archivePath, bytes: await s3.getObjectBytes(storage, file.matter.object) })
  }

  const zipBytes = createZipArchive(objects, plan.directories)
  const targetStorage = (await selectStorage(db, 'private')) as unknown as S3StorageType
  const allowed = await incrementUsageIfAllowed(db, orgId, targetStorage.id, zipBytes.length)
  if (!allowed) throw new Error('Quota exceeded for generated ZIP archive')

  const key = buildObjectKey({ uid: userId, orgId, rawExt: '.zip' })
  let objectWritten = false
  try {
    await s3.putObject(targetStorage, key, zipBytes, ZIP_MIME)
    objectWritten = true
    const matter = await createMatter(db, {
      orgId,
      userId,
      name: plan.outputName,
      type: ZIP_MIME,
      size: zipBytes.length,
      dirtype: DirType.FILE,
      parent: plan.targetFolder,
      object: key,
      storageId: targetStorage.id,
      status: 'active',
      onConflict: 'rename',
    })

    return updateBackgroundJob(db, orgId, jobId, {
      status: 'completed',
      progress: {
        inputBytes: plan.inputBytes,
        outputBytes: zipBytes.length,
        processedBytes: plan.inputBytes,
        fileCount: plan.files.length,
        currentFilename: null,
      },
      resultMetadata: { matterId: matter.id, outputName: matter.name, outputBytes: zipBytes.length },
      cancelable: false,
    })
  } catch (error) {
    await decrementUsage(db, orgId, new Map([[targetStorage.id, zipBytes.length]]), zipBytes.length)
    if (objectWritten) await s3.deleteObject(targetStorage, key)
    throw error
  }
}

async function runExtractionJob(
  db: Database,
  s3: S3Service,
  jobId: string,
  orgId: string,
  userId: string,
  request: Extract<CreateBackgroundJobRequest, { type: 'archive_extract' }>,
): Promise<BackgroundJob> {
  const zipMatter = await getMatter(db, request.matterId, orgId)
  if (!zipMatter || zipMatter.status !== 'active') throw new Error('ZIP matter not found')
  if (zipMatter.dirtype !== DirType.FILE || !zipMatter.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Extraction source must be a .zip file')
  }

  if (request.targetFolder !== undefined) await requireTargetFolder(db, orgId, request.targetFolder)
  const sourceStorage = await requireStorage(db, zipMatter.storageId)
  const zipBytes = await s3.getObjectBytes(sourceStorage, zipMatter.object)
  const archive = validateAndExtractZip(zipBytes)
  const targetFolder = request.targetFolder ?? zipMatter.parent
  const targetStorage = (await selectStorage(db, 'private')) as unknown as S3StorageType
  const allowed = await incrementUsageIfAllowed(db, orgId, targetStorage.id, archive.totalBytes)
  if (!allowed) throw new Error('Quota exceeded for extracted ZIP contents')

  const writtenKeys: string[] = []
  const createdMatterIds: string[] = []
  try {
    const folderParents = new Map<string, string>()
    for (const folderPath of archive.folders) {
      const parts = folderPath.split('/')
      const parentPath = parts.slice(0, -1).join('/')
      const parent = parentPath ? folderParents.get(parentPath) : targetFolder
      if (parent === undefined) throw new Error(`Missing parent folder for ${folderPath}`)
      const folder = await createMatter(db, {
        orgId,
        userId,
        name: parts[parts.length - 1],
        type: 'folder',
        size: 0,
        dirtype: DirType.USER_FOLDER,
        parent,
        object: '',
        storageId: targetStorage.id,
        status: 'active',
        onConflict: 'rename',
      })
      createdMatterIds.push(folder.id)
      folderParents.set(folderPath, buildMatterPath(folder.parent, folder.name))
    }

    for (const file of archive.files) {
      const parent = file.parentPath ? folderParents.get(file.parentPath) : targetFolder
      if (parent === undefined) throw new Error(`Missing parent folder for ${file.path}`)
      const key = buildObjectKey({ uid: userId, orgId, rawExt: extension(file.name) })
      await s3.putObject(targetStorage, key, file.bytes, DEFAULT_FILE_MIME)
      writtenKeys.push(key)
      const matter = await createMatter(db, {
        orgId,
        userId,
        name: file.name,
        type: DEFAULT_FILE_MIME,
        size: file.size,
        dirtype: DirType.FILE,
        parent,
        object: key,
        storageId: targetStorage.id,
        status: 'active',
        onConflict: 'rename',
      })
      createdMatterIds.push(matter.id)
    }

    return updateBackgroundJob(db, orgId, jobId, {
      status: 'completed',
      progress: {
        inputBytes: zipMatter.size ?? zipBytes.length,
        outputBytes: archive.totalBytes,
        processedBytes: zipMatter.size ?? zipBytes.length,
        fileCount: archive.files.length,
        currentFilename: null,
      },
      resultMetadata: { matterIds: createdMatterIds, outputBytes: archive.totalBytes },
      cancelable: false,
    })
  } catch (error) {
    await purgeMatters(db, orgId, createdMatterIds)
    await decrementUsage(db, orgId, new Map([[targetStorage.id, archive.totalBytes]]), archive.totalBytes)
    await s3.deleteObjects(targetStorage, writtenKeys)
    throw error
  }
}

async function requireStorage(db: Database, storageId: string): Promise<S3StorageType> {
  const storage = await getStorage(db, storageId)
  if (!storage) throw new Error('Storage not found')
  return storage as unknown as S3StorageType
}

async function requireTargetFolder(db: Database, orgId: string, targetFolder: string): Promise<void> {
  if (targetFolder === '') return

  const slash = targetFolder.lastIndexOf('/')
  const parent = slash >= 0 ? targetFolder.slice(0, slash) : ''
  const name = slash >= 0 ? targetFolder.slice(slash + 1) : targetFolder
  const rows = await db
    .select()
    .from(matters)
    .where(
      and(eq(matters.orgId, orgId), eq(matters.parent, parent), eq(matters.name, name), eq(matters.status, 'active')),
    )
    .limit(1)
  const target = rows[0]
  if (!target) throw new Error('Target folder not found')
  if (target.dirtype === DirType.FILE) throw new Error('Target folder must be a folder')
}

function buildMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}
