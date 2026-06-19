import { DirType } from '@shared/constants'
import type { CreateBackgroundJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { buildObjectKey } from '../lib/path-template'
import type {
  ArchiveTargetFolderRepo,
  BackgroundJobRepo,
  MatterRepo,
  NotificationRepo,
  QuotaRepo,
  S3Gateway,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
  ZipGateway,
  ZipPlanRepo,
} from './ports'
import { StorageQuotaExceededError, withStorageUsageReservation } from './storage-usage'

// Existing ports the archive orchestration composes. No new persistence beyond
// the target-folder lookup; everything else is reused (matter repo, zip
// gateway/plan, s3, quota/usage reservation, background-job + notification repos).
export type ArchiveProcessingDeps = {
  s3: S3Gateway
  storages: StorageRepo
  quota: QuotaRepo
  storageUsage: StorageUsageRepo
  backgroundJobs: BackgroundJobRepo
  notifications: NotificationRepo
  zip: ZipGateway
  zipPlan: ZipPlanRepo
  archiveTargetFolders: ArchiveTargetFolderRepo
  matter: MatterRepo
}

export interface CreateArchiveJobInput {
  orgId: string
  userId: string
  request: CreateBackgroundJobRequest
  // Overrides deps.s3 for tests; production paths use the wired gateway.
  s3?: S3Gateway
}

const ZIP_MIME = 'application/zip'
const DEFAULT_FILE_MIME = 'application/octet-stream'
const PROGRESS_REPORT_INTERVAL_MS = 1000
const PROGRESS_REPORT_BYTES = 5 * 1024 * 1024

export async function createArchiveJob(
  deps: ArchiveProcessingDeps,
  input: CreateArchiveJobInput,
): Promise<BackgroundJob> {
  const job = await enqueueArchiveJob(deps, input)
  return processArchiveJob(deps, { ...input, jobId: job.id })
}

export async function enqueueArchiveJob(
  deps: ArchiveProcessingDeps,
  input: CreateArchiveJobInput,
): Promise<BackgroundJob> {
  const targetFolder = input.request.targetFolder ?? null
  return deps.backgroundJobs.create({
    orgId: input.orgId,
    userId: input.userId,
    type: input.request.type,
    targetFolder,
    metadata: input.request,
    cancelable: false,
  })
}

export async function processArchiveJob(
  deps: ArchiveProcessingDeps,
  input: CreateArchiveJobInput & { jobId: string },
): Promise<BackgroundJob> {
  const s3 = input.s3 ?? deps.s3
  try {
    await deps.backgroundJobs.update(input.orgId, input.jobId, { status: 'running', startedAt: new Date() })
    const finished =
      input.request.type === 'archive_compress'
        ? await runCompressionJob(deps, s3, input.jobId, input.orgId, input.userId, input.request)
        : await runExtractionJob(deps, s3, input.jobId, input.orgId, input.userId, input.request)
    await notifyArchiveJobFinished(deps, finished)
    return finished
  } catch (error) {
    const failed = await deps.backgroundJobs.update(input.orgId, input.jobId, {
      status: 'failed',
      errorMessage: (error as Error).message,
      retryable: false,
      cancelable: false,
    })
    await notifyArchiveJobFinished(deps, failed)
    return failed
  }
}

async function runCompressionJob(
  deps: ArchiveProcessingDeps,
  s3: S3Gateway,
  jobId: string,
  orgId: string,
  userId: string,
  request: Extract<CreateBackgroundJobRequest, { type: 'archive_compress' }>,
): Promise<BackgroundJob> {
  if (request.targetFolder !== undefined)
    await deps.archiveTargetFolders.requireTargetFolder(orgId, request.targetFolder)
  const plan = await deps.zipPlan.collectCompressionPlan(orgId, request.matterIds, {
    targetFolder: request.targetFolder,
    outputName: request.outputName,
  })
  const progress = createArchiveProgressReporter(deps, orgId, jobId, plan.inputBytes, plan.files.length)
  await progress.report(true)

  const sources = []
  for (const file of plan.files) {
    const storage = await requireStorage(deps, file.matter.storageId)
    sources.push({
      archivePath: file.archivePath,
      openStream: async () => {
        await progress.setCurrentFilename(file.archivePath)
        return trackReadableStream(await s3.getObjectStream(storage, file.matter.object), (chunk) =>
          progress.addProcessedBytes(chunk.byteLength),
        )
      },
    })
  }

  const targetStorage = await deps.storages.select('private')
  const key = buildObjectKey({ uid: userId, orgId, rawExt: '.zip' })
  let objectWritten = false
  let outputBytes = 0
  try {
    outputBytes = await s3.putObject(
      targetStorage,
      key,
      deps.zip.createZipArchiveStream(sources, plan.directories),
      ZIP_MIME,
    )
    objectWritten = true
    const job = await withStorageUsageReservation(
      { quota: deps.quota, storageUsage: deps.storageUsage },
      { orgId, storageId: targetStorage.id, bytes: outputBytes },
      async (ctx) => {
        ctx.onRollback(() => s3.deleteObject(targetStorage, key))
        const matter = await deps.matter.create({
          orgId,
          userId,
          name: plan.outputName,
          type: ZIP_MIME,
          size: outputBytes,
          dirtype: DirType.FILE,
          parent: plan.targetFolder,
          object: key,
          storageId: targetStorage.id,
          status: 'active',
          onConflict: 'rename',
        })

        return deps.backgroundJobs.update(orgId, jobId, {
          status: 'completed',
          progress: {
            inputBytes: plan.inputBytes,
            outputBytes,
            processedBytes: plan.inputBytes,
            fileCount: plan.files.length,
            currentFilename: null,
          },
          resultMetadata: { matterId: matter.id, outputName: matter.name, outputBytes },
          cancelable: false,
        })
      },
    )
    objectWritten = false
    return job
  } catch (error) {
    if (objectWritten) await s3.deleteObject(targetStorage, key)
    if (error instanceof StorageQuotaExceededError) throw new Error('Quota exceeded for generated ZIP archive')
    throw error
  }
}

async function runExtractionJob(
  deps: ArchiveProcessingDeps,
  s3: S3Gateway,
  jobId: string,
  orgId: string,
  userId: string,
  request: Extract<CreateBackgroundJobRequest, { type: 'archive_extract' }>,
): Promise<BackgroundJob> {
  const zipMatter = await deps.matter.get(request.matterId, orgId)
  if (!zipMatter || zipMatter.status !== 'active' || zipMatter.trashedAt != null)
    throw new Error('ZIP matter not found')
  if (zipMatter.dirtype !== DirType.FILE || !zipMatter.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Extraction source must be a .zip file')
  }

  if (request.targetFolder !== undefined)
    await deps.archiveTargetFolders.requireTargetFolder(orgId, request.targetFolder)
  const sourceStorage = await requireStorage(deps, zipMatter.storageId)
  const zip = deps.zip
  const sourceHead = await s3.headObject(sourceStorage, zipMatter.object)
  const plan = await zip.validateZipDirectory(sourceHead.size, (start, end) =>
    s3.getObjectBytes(sourceStorage, zipMatter.object, `bytes=${start}-${end}`),
  )
  const progress = createArchiveProgressReporter(deps, orgId, jobId, sourceHead.size, plan.fileCount)
  await progress.report(true)
  const targetFolder = request.targetFolder ?? zipMatter.parent
  const targetStorage = await deps.storages.select('private')
  const writtenKeys: string[] = []
  const createdMatterIds: string[] = []
  const folderParents = new Map<string, string>()
  try {
    return await withStorageUsageReservation(
      { quota: deps.quota, storageUsage: deps.storageUsage },
      { orgId, storageId: targetStorage.id, bytes: plan.totalBytes },
      async (ctx) => {
        ctx.onRollback(async () => {
          await deps.matter.purge(orgId, createdMatterIds)
          await s3.deleteObjects(targetStorage, writtenKeys)
        })

        for (const folderPath of plan.folders) {
          await ensureExtractedFolder(folderPath)
        }

        const zipStream = trackReadableStream(await s3.getObjectStream(sourceStorage, zipMatter.object), (chunk) =>
          progress.addProcessedBytes(chunk.byteLength),
        )
        const archive = await zip.streamValidatedZip(zipStream, async (file) => {
          await progress.setCurrentFilename(file.path)
          const parent = file.parentPath ? await ensureExtractedFolder(file.parentPath) : targetFolder
          const key = buildObjectKey({ uid: userId, orgId, rawExt: extension(file.name) })
          const size = await s3.putObject(targetStorage, key, file.stream, DEFAULT_FILE_MIME)
          await file.size
          writtenKeys.push(key)
          const matter = await deps.matter.create({
            orgId,
            userId,
            name: file.name,
            type: DEFAULT_FILE_MIME,
            size,
            dirtype: DirType.FILE,
            parent,
            object: key,
            storageId: targetStorage.id,
            status: 'active',
            onConflict: 'rename',
          })
          createdMatterIds.push(matter.id)
        })

        return deps.backgroundJobs.update(orgId, jobId, {
          status: 'completed',
          progress: {
            inputBytes: sourceHead.size,
            outputBytes: archive.totalBytes,
            processedBytes: sourceHead.size,
            fileCount: plan.fileCount,
            currentFilename: null,
          },
          resultMetadata: { matterIds: createdMatterIds, outputBytes: archive.totalBytes },
          cancelable: false,
        })
      },
    )
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) throw new Error('Quota exceeded for extracted ZIP contents')
    throw error
  }

  async function ensureExtractedFolder(folderPath: string): Promise<string> {
    const existing = folderParents.get(folderPath)
    if (existing) return existing

    const parts = folderPath.split('/')
    const parentPath = parts.slice(0, -1).join('/')
    const parent = parentPath ? await ensureExtractedFolder(parentPath) : targetFolder
    const folder = await deps.matter.create({
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
    const matterPath = buildMatterPath(folder.parent, folder.name)
    folderParents.set(folderPath, matterPath)
    return matterPath
  }
}

function createArchiveProgressReporter(
  deps: ArchiveProcessingDeps,
  orgId: string,
  jobId: string,
  inputBytes: number,
  fileCount: number,
) {
  let processedBytes = 0
  let currentFilename: string | null = null
  let lastReportedAt = 0
  let lastReportedBytes = -1
  let lastReportedFilename: string | null = null
  let writes = Promise.resolve()

  async function report(force = false): Promise<void> {
    const now = Date.now()
    const enoughTime = now - lastReportedAt >= PROGRESS_REPORT_INTERVAL_MS
    const enoughBytes = processedBytes - lastReportedBytes >= PROGRESS_REPORT_BYTES
    const complete = inputBytes > 0 && processedBytes >= inputBytes
    if (!force && !enoughTime && !enoughBytes && !complete) return
    if (!force && processedBytes === lastReportedBytes && currentFilename === lastReportedFilename) return

    const snapshot = { processedBytes, currentFilename }
    lastReportedAt = now
    lastReportedBytes = snapshot.processedBytes
    lastReportedFilename = snapshot.currentFilename
    writes = writes.then(() =>
      deps.backgroundJobs
        .update(orgId, jobId, {
          progress: {
            inputBytes,
            fileCount,
            processedBytes: snapshot.processedBytes,
            currentFilename: snapshot.currentFilename,
          },
        })
        .then(() => undefined),
    )
    await writes
  }

  return {
    report,
    async setCurrentFilename(filename: string): Promise<void> {
      currentFilename = filename
      await report(true)
    },
    async addProcessedBytes(bytes: number): Promise<void> {
      processedBytes += bytes
      await report(false)
    },
  }
}

function trackReadableStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      await onChunk(value)
      controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

async function requireStorage(deps: ArchiveProcessingDeps, storageId: string): Promise<StorageRecord> {
  const storage = await deps.storages.get(storageId)
  if (!storage) throw new Error('Storage not found')
  return storage
}

function buildMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

async function notifyArchiveJobFinished(deps: ArchiveProcessingDeps, job: BackgroundJob): Promise<void> {
  const completed = job.status === 'completed'
  const action = job.type === 'archive_extract' ? 'extraction' : 'compression'
  await deps.notifications.create({
    userId: job.userId,
    type: completed ? 'archive_job_completed' : 'archive_job_failed',
    title: completed ? `File ${action} completed` : `File ${action} failed`,
    body: completed
      ? `Background task ${job.id} is complete.`
      : (job.errorMessage ?? `Background task ${job.id} failed.`),
    refType: 'background_job',
    refId: job.id,
    metadata: JSON.stringify({ jobId: job.id, jobType: job.type, status: job.status }),
  })
}
