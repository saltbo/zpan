import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { createArchiveJob } from './archive-processing'
import type { S3Service } from './s3'
import { collectCompressionPlan } from './zip-compress'
import { validateAndExtractZip } from './zip-extract'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

const ORG_ID = 'archive-org'
const USER_ID = 'archive-user'
const STORAGE_ID = 'archive-storage'

class MemoryS3 {
  objects = new Map<string, Uint8Array>()
  putKeys: string[] = []

  async getObjectBytes(_storage: unknown, key: string): Promise<Uint8Array> {
    const bytes = this.objects.get(key)
    if (!bytes) throw new Error(`Object not found: ${key}`)
    return bytes
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

describe('archive processing', () => {
  it('extracts a small ZIP into folder and file matters and writes objects', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/archive.zip', createZip({ 'docs/hello.txt': bytes('hello') }))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Service,
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

  it('compresses selected matters into a ZIP matter and object', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })

    const s3 = new MemoryS3()
    s3.objects.set('objects/a.txt', bytes('hello'))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'] },
      s3: s3 as unknown as S3Service,
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

  it('compresses an empty selected folder as a ZIP directory entry', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'empty-folder', name: 'Empty', object: '', size: 0, dirtype: 1 })

    const s3 = new MemoryS3()

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['empty-folder'] },
      s3: s3 as unknown as S3Service,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    const zipMatter = await db.all<{ object: string }>(sql`
      SELECT object FROM matters
      WHERE org_id = ${ORG_ID} AND name = 'Empty.zip' AND status = 'active'
    `)
    const archive = validateAndExtractZip(s3.objects.get(zipMatter[0].object)!)
    expect(archive.folders).toEqual(['Empty'])
    expect(archive.files).toEqual([])
  })

  it('compresses a folder with an empty subfolder as nested ZIP directory entries', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'parent-folder', name: 'Parent', object: '', size: 0, dirtype: 1 })
    await seedMatter(db, { id: 'child-folder', name: 'Child', parent: 'Parent', object: '', size: 0, dirtype: 1 })

    const s3 = new MemoryS3()

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['parent-folder'] },
      s3: s3 as unknown as S3Service,
    })

    expect(job).toMatchObject({ status: 'completed', type: 'archive_compress' })
    const zipMatter = await db.all<{ object: string }>(sql`
      SELECT object FROM matters
      WHERE org_id = ${ORG_ID} AND name = 'Parent.zip' AND status = 'active'
    `)
    const archive = validateAndExtractZip(s3.objects.get(zipMatter[0].object)!)
    expect(archive.folders).toEqual(['Parent', 'Parent/Child'])
    expect(archive.files).toEqual([])
  })

  it('fails validation before writing output for unsafe ZIP paths', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'bad-zip', name: 'bad.zip', object: 'source/bad.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/bad.zip', createZip({ '../evil.txt': bytes('no') }))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'bad-zip' },
      s3: s3 as unknown as S3Service,
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
      createZip({ 'large.bin': bytes('x') }, { declaredSizes: { 'large.bin': 25 * 1024 * 1024 + 1 } }),
    )

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'large-zip' },
      s3: s3 as unknown as S3Service,
    })

    expect(job).toMatchObject({
      status: 'failed',
      errorMessage: 'ZIP entry exceeds 26214400 bytes',
    })
    expect(s3.putKeys).toHaveLength(0)
  })

  it('fails quota checks without creating visible extracted output', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('archive-quota', ${ORG_ID}, 4, 0, 0, 0, '1970-01')
    `)
    await seedMatter(db, { id: 'quota-zip', name: 'quota.zip', object: 'source/quota.zip', size: 200 })

    const s3 = new MemoryS3()
    s3.objects.set('source/quota.zip', createZip({ 'hello.txt': bytes('hello') }))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'quota-zip' },
      s3: s3 as unknown as S3Service,
    })

    expect(job.status).toBe('failed')
    expect(job.errorMessage).toBe('Quota exceeded for extracted ZIP contents')
    expect(s3.putKeys).toHaveLength(0)
    await expect(activeMatterCount(db)).resolves.toBe(1)
  })

  it('fails compression quota checks before writing output', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES ('archive-compress-quota', ${ORG_ID}, 4, 0, 0, 0, '1970-01')
    `)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })

    const s3 = new MemoryS3()
    s3.objects.set('objects/a.txt', bytes('hello'))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'] },
      s3: s3 as unknown as S3Service,
    })

    expect(job.status).toBe('failed')
    expect(job.errorMessage).toBe('Quota exceeded for generated ZIP archive')
    expect(s3.putKeys).toHaveLength(0)
    await expect(activeMatterCount(db)).resolves.toBe(1)
  })

  it('rejects compression output when an explicit target folder is missing or a file', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'file-a', name: 'a.txt', object: 'objects/a.txt', size: 5 })
    await seedMatter(db, { id: 'file-target', name: 'target.txt', object: 'objects/target.txt', size: 1 })

    const s3 = new MemoryS3()

    const missingTarget = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'], targetFolder: 'missing' },
      s3: s3 as unknown as S3Service,
    })
    const fileTarget = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_compress', matterIds: ['file-a'], targetFolder: 'target.txt' },
      s3: s3 as unknown as S3Service,
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

    const missingJob = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'missing-zip' },
      s3: s3 as unknown as S3Service,
    })
    const plainJob = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'plain-file' },
      s3: s3 as unknown as S3Service,
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

    const missingTarget = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter', targetFolder: 'missing' },
      s3: s3 as unknown as S3Service,
    })
    const fileTarget = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter', targetFolder: 'target.txt' },
      s3: s3 as unknown as S3Service,
    })

    expect(missingTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder not found' })
    expect(fileTarget).toMatchObject({ status: 'failed', errorMessage: 'Target folder must be a folder' })
    expect(s3.putKeys).toHaveLength(0)
  })

  it('fails clearly when archive source storage is missing', async () => {
    const { db } = await createTestApp()
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: new MemoryS3() as unknown as S3Service,
    })

    expect(job).toMatchObject({ status: 'failed', errorMessage: 'Storage not found' })
  })

  it('rolls back extraction quota usage when object writing fails', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'zip-matter', name: 'archive.zip', object: 'source/archive.zip', size: 200 })

    const s3 = new FailingPutS3()
    s3.objects.set('source/archive.zip', createZip({ 'hello.txt': bytes('hello') }))

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Service,
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

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Service,
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

    const job = await createArchiveJob(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      request: { type: 'archive_extract', matterId: 'zip-matter' },
      s3: s3 as unknown as S3Service,
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
      status: 'trashed',
    })
    await seedMatter(db, {
      id: 'large-file',
      name: 'large.bin',
      object: 'objects/large.bin',
      size: 25 * 1024 * 1024 + 1,
    })
    await seedMatter(db, {
      id: 'deep-file',
      name: 'a/b/c/d/e/f/g/h/i/j/k/file.txt',
      object: 'objects/deep.txt',
      size: 1,
    })
    await seedMatter(db, { id: 'same-a', name: 'same.txt', parent: 'a', object: 'objects/same-a.txt', size: 1 })
    await seedMatter(db, { id: 'same-b', name: 'same.txt', parent: 'b', object: 'objects/same-b.txt', size: 1 })

    await expect(collectCompressionPlan(db, ORG_ID, ['missing'])).rejects.toThrow(
      'Some archive source IDs do not belong to this organization',
    )
    await expect(collectCompressionPlan(db, ORG_ID, ['inactive-file'])).rejects.toThrow(
      'Only active matters can be archived',
    )
    await expect(collectCompressionPlan(db, ORG_ID, ['large-file'])).rejects.toThrow(
      'Compression source file exceeds 26214400 bytes',
    )
    await expect(collectCompressionPlan(db, ORG_ID, ['deep-file'])).rejects.toThrow(
      'Compression directory depth exceeds 10',
    )
    await expect(collectCompressionPlan(db, ORG_ID, ['same-a', 'same-b'])).rejects.toThrow(
      'Duplicate archive path: same.txt',
    )
  })

  it('collects folder compression with the selected folder as the archive root', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    await seedMatter(db, { id: 'photos', name: 'Photos', object: '', size: 0, dirtype: 1 })
    await seedMatter(db, { id: 'photo-a', name: 'a.jpg', parent: 'Photos', object: 'objects/a.jpg', size: 1 })

    const plan = await collectCompressionPlan(db, ORG_ID, ['photos'], { outputName: 'backup' })

    expect(plan).toMatchObject({ outputName: 'backup.zip', targetFolder: '' })
    expect(plan.directories.map((directory) => directory.archivePath)).toEqual(['Photos'])
    expect(plan.files.map((file) => file.archivePath)).toEqual(['Photos/a.jpg'])
  })

  it('enforces compression file count limits', async () => {
    const { db } = await createTestApp()
    await seedStorage(db)
    const ids: string[] = []
    for (let index = 0; index < 201; index += 1) {
      const id = `many-${index}`
      ids.push(id)
      await seedMatter(db, { id, name: `${id}.txt`, object: `objects/${id}.txt`, size: 1 })
    }

    await expect(collectCompressionPlan(db, ORG_ID, ids)).rejects.toThrow('Compression file count exceeds 200')
  })

  it('rejects unsafe and unsupported ZIP entries during validation', () => {
    expect(() => validateAndExtractZip(new Uint8Array())).toThrow('Invalid ZIP archive')
    expect(() => validateAndExtractZip(createZip({ '/abs.txt': bytes('x') }))).toThrow('ZIP contains an absolute path')
    expect(() => validateAndExtractZip(createZip({ 'a\\b.txt': bytes('x') }))).toThrow(
      'ZIP paths must use forward slashes',
    )
    expect(() => validateAndExtractZip(createZip({ 'a//b.txt': bytes('x') }))).toThrow(
      'ZIP contains an empty path segment',
    )
    expect(() =>
      validateAndExtractZip(createZip({ 'secret.txt': bytes('x') }, { flags: { 'secret.txt': 1 } })),
    ).toThrow('Encrypted ZIP archives are not supported')
    expect(() =>
      validateAndExtractZip(createZip({ 'unsupported.txt': bytes('x') }, { compression: { 'unsupported.txt': 14 } })),
    ).toThrow('ZIP contains unsupported compression method')
    expect(() =>
      validateAndExtractZip(
        createZip({ 'link.txt': bytes('x') }, { externalAttributes: { 'link.txt': 0o120000 << 16 } }),
      ),
    ).toThrow('ZIP contains unsupported entry type')
    expect(() => validateAndExtractZip(createZip({ 'a/b/c/d/e/f/g/h/i/j/k/file.txt': bytes('x') }))).toThrow(
      'ZIP directory depth exceeds 10',
    )
  })

  it('enforces ZIP validation count and total output limits from metadata', () => {
    const manyEntries = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`file-${index}.txt`, bytes('x')]))
    expect(() => validateAndExtractZip(createZip(manyEntries))).toThrow('ZIP file count exceeds 200')
    const totalLimitEntries = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`total-${index}`, bytes('x')]),
    )
    const totalLimitSizes = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [`total-${index}`, 21 * 1024 * 1024]),
    )
    expect(() => validateAndExtractZip(createZip(totalLimitEntries, { declaredSizes: totalLimitSizes }))).toThrow(
      'ZIP extraction output exceeds 104857600 bytes',
    )
  })
})

async function seedStorage(db: TestDb): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'Archive Storage', 'private', 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
  `)
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
  },
): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${ORG_ID}, ${`${opts.id}-alias`}, ${opts.name}, ${opts.type ?? 'text/plain'}, ${opts.size}, ${opts.dirtype ?? 0}, ${opts.parent ?? ''}, ${opts.object}, ${STORAGE_ID}, ${opts.status ?? 'active'}, ${now}, ${now})
  `)
}

async function activeMatterCount(db: TestDb): Promise<number> {
  const rows = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count FROM matters WHERE org_id = ${ORG_ID} AND status = 'active'
  `)
  return rows[0]?.count ?? 0
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
