import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { BackgroundJob } from '../../shared/types'
import { createZipGateway } from '../adapters/gateways/zip'
import { createArchiveTargetFolderRepo } from '../adapters/repos/archive-target-folder'
import { createBackgroundJobRepo } from '../adapters/repos/background-job'
import { createMatterRepo } from '../adapters/repos/matter'
import { createNotificationRepo } from '../adapters/repos/notification'
import { createQuotaRepo } from '../adapters/repos/quota'
import { createStorageRepo } from '../adapters/repos/storage'
import { createStorageUsageRepo } from '../adapters/repos/storage-usage'
import { createZipPlanRepo } from '../adapters/repos/zip'
import { createTestApp } from '../test/setup.js'
import {
  type ArchiveProcessingDeps,
  createArchiveJob,
  enqueueArchiveJob,
  processArchiveJob,
} from './archive-processing'
import { type S3Gateway, ZIP_COMPRESS_LIMITS, ZIP_EXTRACT_LIMITS } from './ports'

const zip = createZipGateway()

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

// Assembles the same port subset the queue-consumer gateway wires, so the usecase
// runs against real repos over the in-memory DB while each test still injects its
// own S3 fake via `input.s3`.
function archiveDeps(db: TestDb): ArchiveProcessingDeps {
  return {
    s3: undefined as unknown as S3Gateway,
    storages: createStorageRepo(db),
    quota: createQuotaRepo(db),
    storageUsage: createStorageUsageRepo(db),
    backgroundJobs: createBackgroundJobRepo(db),
    notifications: createNotificationRepo(db),
    zip: createZipGateway(),
    zipPlan: createZipPlanRepo(db),
    archiveTargetFolders: createArchiveTargetFolderRepo(db),
    matter: createMatterRepo(db),
  }
}

const ORG_ID = 'archive-org'
const USER_ID = 'archive-user'
const STORAGE_ID = 'archive-storage'

async function seedStoragePlanEntitlement(db: TestDb, orgId: string, bytes: number, id: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${id}, ${orgId}, 'storage', 'plan', 'test', ${`${id}:${orgId}`}, ${bytes}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
}

class MemoryS3 {
  objects = new Map<string, Uint8Array>()
  putKeys: string[] = []

  async getObjectBytes(_storage: unknown, key: string, range?: string): Promise<Uint8Array> {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error(`Object not found: ${key}`)
    if (range) return sliceRange(bytes, range)
    return bytes
  }

  async headObject(_storage: unknown, key: string): Promise<{ size: number; contentType: string; etag: string }> {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error(`Object not found: ${key}`)
    return { size: bytes.byteLength, contentType: 'application/octet-stream', etag: 'archive-etag' }
  }

  async getObjectStream(_storage: unknown, key: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = await this.getObjectBytes(_storage, key)
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }

  async putObject(_storage: unknown, key: string, body: Uint8Array | ReadableStream): Promise<number> {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    this.objects.set(key, bytes)
    this.putKeys.push(key)
    return bytes.byteLength
  }

  async deleteObject(_storage: unknown, key: string): Promise<void> {
    this.objects.delete(key)
  }

  async deleteObjects(_storage: unknown, keys: string[]): Promise<void> {
    for (const key of keys) this.objects.delete(key)
  }
}

class FailingPutS3 extends MemoryS3 {
  async putObject(): Promise<number> {
    throw new Error('S3 put failed')
  }
}

class FailAfterPutS3 extends MemoryS3 {
  private attempts = 0

  constructor(private readonly failAt: number) {
    super()
  }

  override async putObject(storage: unknown, key: string, body: Uint8Array | ReadableStream): Promise<number> {
    this.attempts += 1
    if (this.attempts === this.failAt) throw new Error('S3 put failed')
    return super.putObject(storage, key, body)
  }
}

class GeneratedObjectS3 extends MemoryS3 {
  putSizes = new Map<string, number>()

  constructor(
    protected readonly generatedKey: string,
    protected readonly generatedSize: number,
  ) {
    super()
  }

  override async getObjectStream(_storage: unknown, key: string): Promise<ReadableStream<Uint8Array>> {
    if (key === this.generatedKey) return generatedBytes(this.generatedSize)
    return super.getObjectStream(_storage, key)
  }

  override async putObject(_storage: unknown, key: string, body: Uint8Array | ReadableStream): Promise<number> {
    const size = body instanceof Uint8Array ? body.byteLength : await drainStream(body)
    this.objects.set(key, new Uint8Array())
    this.putKeys.push(key)
    this.putSizes.set(key, size)
    return size
  }
}

class BlockingGeneratedObjectS3 extends GeneratedObjectS3 {
  readonly firstChunkRead: Promise<void>
  private resolveFirstChunkRead!: () => void
  private releaseNextChunk!: () => void
  private released = false

  constructor(
    generatedKey: string,
    generatedSize: number,
    private readonly chunkSize: number,
  ) {
    super(generatedKey, generatedSize)
    this.firstChunkRead = new Promise((resolve) => {
      this.resolveFirstChunkRead = resolve
    })
  }

  override async getObjectStream(_storage: unknown, key: string): Promise<ReadableStream<Uint8Array>> {
    if (key === this.generatedKey) {
      return blockingBytes(this.generatedSize, this.chunkSize, this.resolveFirstChunkRead, () => this.waitForRelease())
    }
    return super.getObjectStream(_storage, key)
  }

  release(): void {
    this.released = true
    this.releaseNextChunk?.()
  }

  private waitForRelease(): Promise<void> {
    if (this.released) return Promise.resolve()
    return new Promise((resolve) => {
      this.releaseNextChunk = resolve
    })
  }
}

class BlockingStoredObjectS3 extends MemoryS3 {
  readonly firstChunkRead: Promise<void>
  private resolveFirstChunkRead!: () => void
  private releaseNextChunk!: () => void
  private released = false

  constructor(private readonly chunkSize: number) {
    super()
    this.firstChunkRead = new Promise((resolve) => {
      this.resolveFirstChunkRead = resolve
    })
  }

  override async getObjectStream(_storage: unknown, key: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = await this.getObjectBytes(_storage, key)
    return blockingStoredBytes(bytes, this.chunkSize, this.resolveFirstChunkRead, () => this.waitForRelease())
  }

  release(): void {
    this.released = true
    this.releaseNextChunk?.()
  }

  private waitForRelease(): Promise<void> {
    if (this.released) return Promise.resolve()
    return new Promise((resolve) => {
      this.releaseNextChunk = resolve
    })
  }
}

describe('archive processing', () => {
  it('extracts a small ZIP into folder and file matters and writes objects', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/archive.zip', createZip({ 'docs/hello.txt': bytes('hello') }))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_extract' })
    expect(job.progress).toMatchObject({ outputBytes: 5, fileCount: 1 })
    const rows = await db.all<{ name: string; parent: string; dirtype: number; size: number; object: string }>(sql`
      SELECT name, parent, dirtype, size, object FROM matters
      WHERE org_id = ${ORG_ID} AND status = 'active'
      ORDER BY dirtype DESC, name ASC
    `)
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'docs', parent: '', dirtype: 1, size: 0 }),
        expect.objectContaining({ name: 'hello.txt', parent: 'docs', dirtype: 0, size: 5 }),
      ]),
    )
    expect(s3.putKeys).toHaveLength(1)
  })

  it('prevalidates then streams extraction for a 128 MiB ZIP entry', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const size = 128 * 1024 * 1024
    const archive = await streamToBytes(
      zip.createZipArchiveStream([{ archivePath: 'large.bin', openStream: async () => generatedBytes(size) }]),
    )
    await seedMatter(db, { id: 'large-zip', name: 'large.zip', object: 'source/large.zip', size: archive.byteLength })

    const s3 = new GeneratedObjectS3('unused', 0)
    s3.objects.set('source/large.zip', archive)
    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'large-zip' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_extract' })
    expect(job.progress).toMatchObject({ outputBytes: size, fileCount: 1 })
    expect(s3.putKeys).toHaveLength(1)
    expect(s3.putSizes.get(s3.putKeys[0])).toBe(size)
  }, 60_000)

  it('compresses selected matters into a ZIP matter and object', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })

    const s3 = new MemoryS3()
    s3.objects.set('objects/a.txt', bytes('hello'))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'] },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    expect(job.resultMetadata).toMatchObject({ outputName: 'a.txt.zip' })
    const zipMatter = await db.all<{ name: string; type: string; size: number; object: string }>(sql`
      SELECT name, type, size, object FROM matters
      WHERE org_id = ${ORG_ID} AND name = 'a.txt.zip' AND status = 'active'
    `)
    expect(zipMatter).toHaveLength(1)
    expect(zipMatter[0].type).toBe('application/zip')
    expect(s3.objects.get(zipMatter[0].object)?.length).toBe(zipMatter[0].size)
  })

  it('streams compression for a 128 MiB source without buffering the source object', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const size = 128 * 1024 * 1024
    await seedMatter(db, { id: 'large-file', name: 'large.bin', object: 'objects/large.bin', size })

    const s3 = new GeneratedObjectS3('objects/large.bin', size)
    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['large-file'] },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    expect(job.progress).toMatchObject({ inputBytes: size, processedBytes: size, fileCount: 1 })
    expect(s3.putKeys).toHaveLength(1)
    expect(s3.putSizes.get(s3.putKeys[0]) ?? 0).toBeGreaterThan(0)
  }, 60_000)

  it('persists compression progress while streaming source objects', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const size = 12 * 1024 * 1024
    await seedMatter(db, { id: 'progress-file', name: 'large.bin', object: 'objects/progress.bin', size })

    const s3 = new BlockingGeneratedObjectS3('objects/progress.bin', size, 6 * 1024 * 1024)
    const request = { type: 'archive_compress' as const, matterIds: ['progress-file'] }
    const queued = await enqueueArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request,
      s3: s3 as unknown as S3Gateway,
    })
    const processing = processArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request,
      jobId: queued.id,
      s3: s3 as unknown as S3Gateway,
    })

    try {
      await s3.firstChunkRead
      const running = await waitForJobProgress(db, queued.id, (job) => job.progress.processedBytes > 0)
      expect(running.status).toBe('running')
      expect(running.progress.processedBytes).toBeLessThan(size)
      expect(running.progress.currentFilename).toBe('large.bin')
    } finally {
      s3.release()
    }

    const finished = await processing
    expect(finished.progress).toMatchObject({ inputBytes: size, processedBytes: size, currentFilename: null })
  }, 30_000)

  it('persists extraction progress while streaming ZIP bytes', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const size = 12 * 1024 * 1024
    const archive = createZip({ 'large.bin': filledBytes(size) })
    await seedMatter(db, {
      id: 'progress-zip',
      name: 'progress.zip',
      object: 'source/progress.zip',
      size: archive.byteLength,
    })

    const s3 = new BlockingStoredObjectS3(6 * 1024 * 1024)
    s3.objects.set('source/progress.zip', archive)
    const request = { type: 'archive_extract' as const, matterId: 'progress-zip' }
    const queued = await enqueueArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request,
      s3: s3 as unknown as S3Gateway,
    })
    const processing = processArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request,
      jobId: queued.id,
      s3: s3 as unknown as S3Gateway,
    })

    try {
      await s3.firstChunkRead
      const running = await waitForJobProgress(db, queued.id, (job) => job.progress.processedBytes > 0)
      expect(running.status).toBe('running')
      expect(running.progress.processedBytes).toBeLessThan(archive.byteLength)
    } finally {
      s3.release()
    }

    const finished = await processing
    expect(finished.progress).toMatchObject({
      inputBytes: archive.byteLength,
      processedBytes: archive.byteLength,
      outputBytes: size,
      currentFilename: null,
    })
  }, 30_000)

  it('compresses an empty selected folder as a ZIP directory entry', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'empty-folder', name: 'Empty', object: '', size: 0, dirtype: 1 })

    const s3 = new MemoryS3()

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['empty-folder'] },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    const zipMatter = await db.all<{ object: string }>(sql`
      SELECT object FROM matters
      WHERE org_id = ${ORG_ID} AND name = 'Empty.zip' AND status = 'active'
    `)
    const archive = zip.validateAndExtractZip(s3.objects.get(zipMatter[0].object)!)
    expect(archive.folders).toEqual(['Empty'])
    expect(archive.files).toEqual([])
  })

  it('compresses a folder with an empty subfolder as nested ZIP directory entries', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'parent-folder', name: 'Parent', object: '', size: 0, dirtype: 1 })
    await seedMatter(db, { id: 'child-folder', name: 'Child', parent: 'Parent', object: '', size: 0, dirtype: 1 })

    const s3 = new MemoryS3()

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['parent-folder'] },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    const zipMatter = await db.all<{ object: string }>(sql`
      SELECT object FROM matters
      WHERE org_id = ${ORG_ID} AND name = 'Parent.zip' AND status = 'active'
    `)
    const archive = zip.validateAndExtractZip(s3.objects.get(zipMatter[0].object)!)
    expect(archive.folders).toEqual(['Parent', 'Parent/Child'])
    expect(archive.files).toEqual([])
  })

  it('fails validation before writing output for unsafe ZIP paths', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'bad-zip', name: 'bad.zip', object: 'source/bad.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/bad.zip', createZip({ '../evil.txt': bytes('no') }))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'bad-zip' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job.status).toBe('failed')
    expect(job.errorMessage).toBe('ZIP paths cannot contain ..')
    expect(s3.putKeys).toHaveLength(0)
    await expect(activeMatterCount(db)).resolves.toBe(1)
  })

  it('enforces extraction limits with specific job failure errors', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'large-zip', name: 'large.zip', object: 'source/large.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set(
      'source/large.zip',
      createZip(
        { 'large.bin': bytes('x') },
        { declaredSizes: { 'large.bin': ZIP_EXTRACT_LIMITS.singleFileBytes + 1 } },
      ),
    )

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'large-zip' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({
      status: 'failed',
      errorMessage: `ZIP entry exceeds ${ZIP_EXTRACT_LIMITS.singleFileBytes} bytes`,
    })
    expect(s3.putKeys).toHaveLength(0)
  })

  it('fails quota checks without creating visible extracted output', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await db.run(sql`UPDATE org_quota_entitlements SET bytes = 4 WHERE id = 'archive-default-quota-plan'`)
    await seedMatter(db, { id: 'quota-zip', name: 'quota.zip', object: 'source/quota.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/quota.zip', createZip({ 'hello.txt': bytes('hello') }))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'quota-zip' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job.status).toBe('failed')
    expect(job.errorMessage).toBe('Quota exceeded for extracted ZIP contents')
    expect(s3.objects.size).toBe(1)
    await expect(activeMatterCount(db)).resolves.toBe(1)
  })

  it('fails compression quota checks and removes streamed output', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await db.run(sql`UPDATE org_quota_entitlements SET bytes = 4 WHERE id = 'archive-default-quota-plan'`)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })

    const s3 = new MemoryS3()
    s3.objects.set('objects/a.txt', bytes('hello'))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'] },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job.status).toBe('failed')
    expect(job.errorMessage).toBe('Quota exceeded for generated ZIP archive')
    expect(s3.objects.size).toBe(1)
    await expect(activeMatterCount(db)).resolves.toBe(1)
  })

  it('rejects compression output when an explicit target folder is missing or a file', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })
    await seedMatter(db, { id: 'file-target', name: 'target.txt', object: 'objects/target.txt', size: 1 })

    const s3 = new MemoryS3()

    const missingTarget = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'], targetFolder: 'missing' },
      s3: s3 as unknown as S3Gateway,
    })
    const fileTarget = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'], targetFolder: 'target.txt' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(missingTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder not found' })
    expect(fileTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder must be a folder' })
    expect(s3.putKeys).toHaveLength(0)
  })

  it('fails extraction source validation for missing and non-ZIP matters', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'plain-file', name: 'plain.txt', object: 'objects/plain.txt', size: 5 })

    const s3 = new MemoryS3()

    const missingJob = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'missing-zip' },
      s3: s3 as unknown as S3Gateway,
    })
    const plainJob = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'plain-file' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(missingJob).toMatchObject({ status: 'failed', errorMessage: 'ZIP matter not found' })
    expect(plainJob).toMatchObject({ status: 'failed', errorMessage: 'Extraction source must be a .zip file' })
  })

  it('rejects extraction output when an explicit target folder is missing or a file', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })
    await seedMatter(db, { id: 'file-target', name: 'target.txt', object: 'objects/target.txt', size: 1 })

    const s3 = new MemoryS3()

    const missingTarget = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter', targetFolder: 'missing' },
      s3: s3 as unknown as S3Gateway,
    })
    const fileTarget = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter', targetFolder: 'target.txt' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(missingTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder not found' })
    expect(fileTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder must be a folder' })
    expect(s3.putKeys).toHaveLength(0)
  })

  it('fails clearly when archive source storage is missing', async () => {
    const { db } = await createTestApp()
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: new MemoryS3() as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'failed', errorMessage: 'Storage not found' })
  })

  it('rolls back extraction quota usage when object writing fails', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new FailingPutS3()
    s3.objects.set('source/archive.zip', createZip({ 'hello.txt': bytes('hello') }))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'failed', errorMessage: 'S3 put failed' })
    await expect(activeMatterCount(db)).resolves.toBe(1)
    const usage = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(usage[0].used).toBe(0)
  })

  it('removes generated folders when nested extraction write fails', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new FailingPutS3()
    s3.objects.set('source/archive.zip', createZip({ 'docs/hello.txt': bytes('hello') }))

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'failed', errorMessage: 'S3 put failed' })
    await expect(activeMatterCount(db)).resolves.toBe(1)
    const usage = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(usage[0].used).toBe(0)
  })

  it('removes generated file matters and objects when a later extraction write fails', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new FailAfterPutS3(2)
    s3.objects.set(
      'source/archive.zip',
      createZip({
        'a.txt': bytes('first'),
        'b.txt': bytes('second'),
      }),
    )

    const job = await createArchiveJob(archiveDeps(db), {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Gateway,
    })

    expect(job).toMatchObject({ status: 'failed', errorMessage: 'S3 put failed' })
    await expect(activeMatterCount(db)).resolves.toBe(1)
    expect(s3.putKeys).toHaveLength(1)
    expect(s3.objects.size).toBe(1)
    expect([...s3.objects.keys()]).toEqual(['source/archive.zip'])
    const usage = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(usage[0].used).toBe(0)
  })

  it('validates compression source ownership, status, limits, and archive paths', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, {
      id: 'inactive-file',
      name: 'inactive.txt',
      object: 'objects/inactive.txt',
      size: 1,
      // Trashed = active row with trashedAt set; archiving rejects it.
      trashedAt: Date.now(),
    })
    await seedMatter(db, {
      id: 'large-file',
      name: 'large.bin',
      object: 'objects/large.bin',
      size: ZIP_COMPRESS_LIMITS.singleFileBytes + 1,
    })
    await seedMatter(db, {
      id: 'deep-file',
      name: 'a/b/c/d/e/f/g/h/i/j/k/file.txt',
      object: 'objects/deep.txt',
      size: 1,
    })
    await seedMatter(db, { id: 'same-a', name: 'same.txt', parent: 'a', object: 'objects/same-a.txt', size: 1 })
    await seedMatter(db, { id: 'same-b', name: 'same.txt', parent: 'b', object: 'objects/same-b.txt', size: 1 })

    const zipPlan = createZipPlanRepo(db)
    await expect(zipPlan.collectCompressionPlan(ORG_ID, ['missing'])).rejects.toThrow(
      'Some archive source IDs do not belong to this organization',
    )
    await expect(zipPlan.collectCompressionPlan(ORG_ID, ['inactive-file'])).rejects.toThrow(
      'Only active matters can be archived',
    )
    await expect(zipPlan.collectCompressionPlan(ORG_ID, ['large-file'])).rejects.toThrow(
      `Compression source file exceeds ${ZIP_COMPRESS_LIMITS.singleFileBytes} bytes`,
    )
    await expect(zipPlan.collectCompressionPlan(ORG_ID, ['deep-file'])).rejects.toThrow(
      'Compression directory depth exceeds 10',
    )
    await expect(zipPlan.collectCompressionPlan(ORG_ID, ['same-a', 'same-b'])).rejects.toThrow(
      'Duplicate archive path: same.txt',
    )
  })

  it('collects folder compression with the selected folder as the archive root', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'photos', name: 'Photos', object: '', size: 0, dirtype: 1 })
    await seedMatter(db, { id: 'photo-a', name: 'a.jpg', parent: 'Photos', object: 'objects/a.jpg', size: 1 })

    const plan = await createZipPlanRepo(db).collectCompressionPlan(ORG_ID, ['photos'], { outputName: 'backup' })

    expect(plan).toMatchObject({ outputName: 'backup.zip', targetFolder: '' })
    expect(plan.directories.map((directory) => directory.archivePath)).toEqual(['Photos'])
    expect(plan.files.map((file) => file.archivePath)).toEqual(['Photos/a.jpg'])
  })

  it('enforces compression file count limits', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const ids: string[] = []
    for (let index = 0; index < ZIP_COMPRESS_LIMITS.fileCount + 1; index += 1) {
      const id = `many-${index}`
      ids.push(id)
      await seedMatter(db, { id, name: `${id}.txt`, object: `objects/${id}.txt`, size: 1 })
    }

    await expect(createZipPlanRepo(db).collectCompressionPlan(ORG_ID, ids)).rejects.toThrow(
      `Compression file count exceeds ${ZIP_COMPRESS_LIMITS.fileCount}`,
    )
  })

  it('rejects unsafe and unsupported ZIP entries during validation', () => {
    expect(() => zip.validateAndExtractZip(new Uint8Array())).toThrow('Invalid ZIP archive')
    expect(() => zip.validateAndExtractZip(createZip({ '/abs.txt': bytes('x') }))).toThrow(
      'ZIP contains an absolute path',
    )
    expect(() => zip.validateAndExtractZip(createZip({ 'a\\b.txt': bytes('x') }))).toThrow(
      'ZIP paths must use forward slashes',
    )
    expect(() => zip.validateAndExtractZip(createZip({ 'a//b.txt': bytes('x') }))).toThrow(
      'ZIP contains an empty path segment',
    )
    expect(() =>
      zip.validateAndExtractZip(createZip({ 'secret.txt': bytes('x') }, { flags: { 'secret.txt': 1 } })),
    ).toThrow('Encrypted ZIP archives are not supported')
    expect(() =>
      zip.validateAndExtractZip(
        createZip({ 'unsupported.txt': bytes('x') }, { compression: { 'unsupported.txt': 14 } }),
      ),
    ).toThrow('ZIP contains unsupported compression method')
    expect(() =>
      zip.validateAndExtractZip(
        createZip({ 'link.txt': bytes('x') }, { externalAttributes: { 'link.txt': 0o120000 << 16 } }),
      ),
    ).toThrow('ZIP contains unsupported entry type')
    expect(() => zip.validateAndExtractZip(createZip({ 'a/b/c/d/e/f/g/h/i/j/k/file.txt': bytes('x') }))).toThrow(
      'ZIP directory depth exceeds 10',
    )
  })

  it('enforces ZIP validation count and total output limits from metadata', () => {
    const manyEntries = Object.fromEntries(
      Array.from({ length: ZIP_EXTRACT_LIMITS.fileCount + 1 }, (_, index) => [`file-${index}.txt`, bytes('x')]),
    )
    expect(() => zip.validateAndExtractZip(createZip(manyEntries))).toThrow(
      `ZIP file count exceeds ${ZIP_EXTRACT_LIMITS.fileCount}`,
    )
    const totalLimitEntries = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`total-${index}`, bytes('x')]),
    )
    const totalLimitSizes = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`total-${index}`, 256 * 1024 * 1024]),
    )
    expect(() => zip.validateAndExtractZip(createZip(totalLimitEntries, { declaredSizes: totalLimitSizes }))).toThrow(
      `ZIP extraction output exceeds ${ZIP_EXTRACT_LIMITS.totalOutputBytes} bytes`,
    )
  })
})

async function seedStorage(db: TestDb): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES ('archive-default-quota', ${ORG_ID}, 0, 0, 0, 0, '1970-01')
  `)
  await seedStoragePlanEntitlement(db, ORG_ID, 10 * 1024 ** 3, 'archive-default-quota-plan')
}

async function seedMatter(
  db: TestDb,
  opts: {
    id: string
    name: string
    object: string
    size: number
    parent?: string
    type?: string
    status?: string
    dirtype?: number
    trashedAt?: number
  },
): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${opts.id}, ${ORG_ID}, ${`${opts.id}-alias`}, ${opts.name}, ${opts.type ?? 'text/plain'}, ${opts.size}, ${opts.dirtype ?? 0}, ${opts.parent ?? ''}, ${opts.object}, ${STORAGE_ID}, ${opts.status ?? 'active'}, ${opts.trashedAt ?? null}, ${now}, ${now})
  `)
}

async function activeMatterCount(db: TestDb): Promise<number> {
  const rows = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count
    FROM matters
    WHERE org_id = ${ORG_ID} AND status = 'active' AND purged_at IS NULL
  `)
  return rows[0]?.count ?? 0
}

async function waitForJobProgress(
  db: TestDb,
  jobId: string,
  predicate: (job: BackgroundJob) => boolean,
): Promise<BackgroundJob> {
  const deadline = Date.now() + 3000
  for (;;) {
    const job = await createBackgroundJobRepo(db).get(ORG_ID, jobId)
    if (predicate(job)) return job
    if (Date.now() >= deadline) throw new Error('Timed out waiting for archive job progress')
    await sleep(20)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ZipFixtureOptions {
  declaredSizes?: Record<string, number>
  flags?: Record<string, number>
  compression?: Record<string, number>
  externalAttributes?: Record<string, number>
}

function createZip(files: Record<string, Uint8Array>, opts: ZipFixtureOptions = {}): Uint8Array {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [name, data] of Object.entries(files)) {
    const filename = encoder.encode(name)
    const crc = crc32(data)
    const declaredSize = opts.declaredSizes?.[name] ?? data.length
    const flags = opts.flags?.[name] ?? 0x0800
    const compression = opts.compression?.[name] ?? 0
    const local = new Uint8Array(30 + filename.length + data.length)
    write32(local, 0, 0x04034b50)
    write16(local, 6, flags)
    write16(local, 8, compression)
    write32(local, 14, crc)
    write32(local, 18, data.length)
    write32(local, 22, declaredSize)
    write16(local, 26, filename.length)
    local.set(filename, 30)
    local.set(data, 30 + filename.length)
    localParts.push(local)

    const central = new Uint8Array(46 + filename.length)
    write32(central, 0, 0x02014b50)
    write16(central, 8, flags)
    write16(central, 10, compression)
    write32(central, 16, crc)
    write32(central, 20, data.length)
    write32(central, 24, declaredSize)
    write16(central, 28, filename.length)
    write32(central, 38, opts.externalAttributes?.[name] ?? 0)
    write32(central, 42, offset)
    central.set(filename, 46)
    centralParts.push(central)
    offset += local.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const eocd = new Uint8Array(22)
  write32(eocd, 0, 0x06054b50)
  write16(eocd, 8, centralParts.length)
  write16(eocd, 10, centralParts.length)
  write32(eocd, 12, centralSize)
  write32(eocd, 16, offset)
  return concat([...localParts, ...centralParts, eocd])
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function filledBytes(size: number): Uint8Array {
  const data = new Uint8Array(size)
  data.fill(7)
  return data
}

function generatedBytes(size: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024)
  let remaining = size
  return new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close()
        return
      }
      const length = Math.min(chunk.byteLength, remaining)
      controller.enqueue(length === chunk.byteLength ? chunk : chunk.slice(0, length))
      remaining -= length
    },
  })
}

function blockingBytes(
  size: number,
  chunkSize: number,
  onFirstChunk: () => void,
  waitAfterFirstChunk: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(chunkSize)
  let remaining = size
  let chunks = 0
  return new ReadableStream({
    async pull(controller) {
      if (remaining <= 0) {
        controller.close()
        return
      }
      if (chunks === 1) await waitAfterFirstChunk()

      const length = Math.min(chunk.byteLength, remaining)
      controller.enqueue(length === chunk.byteLength ? chunk : chunk.slice(0, length))
      remaining -= length
      chunks += 1
      if (chunks === 1) onFirstChunk()
    },
  })
}

function blockingStoredBytes(
  bytes: Uint8Array,
  chunkSize: number,
  onFirstChunk: () => void,
  waitAfterFirstChunk: () => Promise<void>,
): ReadableStream<Uint8Array> {
  let offset = 0
  let chunks = 0
  return new ReadableStream({
    async pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      if (chunks === 1) await waitAfterFirstChunk()

      const nextOffset = Math.min(bytes.byteLength, offset + chunkSize)
      controller.enqueue(bytes.slice(offset, nextOffset))
      offset = nextOffset
      chunks += 1
      if (chunks === 1) onFirstChunk()
    },
  })
}

async function drainStream(stream: ReadableStream): Promise<number> {
  const reader = stream.getReader()
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return size
    size += value instanceof Uint8Array ? value.byteLength : 0
  }
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function sliceRange(bytes: Uint8Array, range: string): Uint8Array {
  const match = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (!match) throw new Error(`Unsupported range: ${range}`)
  return bytes.slice(Number(match[1]), Number(match[2]) + 1)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function write16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function write32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
