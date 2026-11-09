import { env } from 'cloudflare:workers'
import { DirType } from '@shared/constants'
import { mediaLibraryFeedSchema } from '@shared/schemas'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../server/adapters/gateways/s3'
import { createBackgroundJobRepo } from '../server/adapters/repos/background-job'
import { createMatterRepo } from '../server/adapters/repos/matter'
import { createMediaLibraryRepo } from '../server/adapters/repos/media-library'
import { orgQuotaEntitlements, orgQuotas } from '../server/db/schema'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import type { BackgroundJobMessage } from '../server/usecases/ports'
import { generateId } from '../shared/ids'
import worker from './bootstrap'

const QUOTA_BYTES = 10_000_000
const testEnv = { ...env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars' }

afterEach(() => {
  vi.restoreAllMocks()
})

// Literal descendants only: these paths contain LIKE wildcards, CJK text, and
// siblings that share a prefix, which a LIKE- or SUBSTR-free range must handle on D1.
const LIBRARY_PATHS = [`Media/${'Long.Movie.Title.'.repeat(5)}[TGx]_100%`, `媒体/电影/${'长目录'.repeat(20)}_100%`]

async function seedWorkspace() {
  const db = createCloudflarePlatform(env).db
  const orgId = generateId()
  const userId = generateId()
  const storageId = generateId()
  const now = Date.now()
  await db.run(sql`INSERT INTO organization (id, name, slug, metadata) VALUES (${orgId}, 'CF Media', ${orgId}, '{}')`)
  await db.insert(orgQuotas).values({ id: generateId(), orgId, quota: QUOTA_BYTES })
  await db.insert(orgQuotaEntitlements).values({
    id: generateId(),
    orgId,
    resourceType: 'storage',
    entitlementType: 'plan',
    source: 'free_plan',
    sourceId: `free_plan:${orgId}`,
    bytes: QUOTA_BYTES,
    startsAt: new Date(),
    expiresAt: null,
    status: 'active',
    metadata: JSON.stringify({ packageName: 'Free', source: 'free_plan' }),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${storageId}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
    `)
  const objects = new Map<string, Uint8Array>()
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    objects.set(key, bytes)
    return bytes.byteLength
  })
  vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
    objects.delete(key)
  })

  const matters = createMatterRepo(db)
  const add = (parent: string, name: string, dirtype: number = DirType.FILE) =>
    matters.create({
      orgId,
      name,
      type: dirtype === DirType.FILE ? 'application/octet-stream' : 'folder',
      size: dirtype === DirType.FILE ? 100 : 0,
      dirtype,
      parent,
      object: dirtype === DirType.FILE ? `objects/${generateId()}` : '',
      storageId,
      status: 'active',
    })
  const addFolders = async (path: string) => {
    let parent = ''
    let folderId = ''
    for (const segment of path.split('/')) {
      folderId = (await add(parent, segment, DirType.USER_FOLDER)).id
      parent = parent ? `${parent}/${segment}` : segment
    }
    return folderId
  }

  // Marks the folder as a library with an empty index, runs one scan message
  // through the queue consumer, and returns the job, the index row, and the feed.
  const scan = async (libraryPath: string, folderId: string) => {
    const library = await createMediaLibraryRepo(db).create({
      orgId,
      folderId,
      createdByUserId: userId,
      createdBy: { type: 'user', ref: userId, issuer: null },
    })
    if (!library) throw new Error('library not created')
    const seededIndex = await matters.create({
      orgId,
      name: 'library.json',
      type: 'application/feed+json',
      size: 0,
      dirtype: DirType.FILE,
      parent: libraryPath,
      object: `objects/${generateId()}`,
      storageId,
      status: 'active',
    })
    const request = { type: 'media_library_scan' as const, libraryId: library.id }
    const job = await createBackgroundJobRepo(db).create({ orgId, userId, type: request.type, metadata: request })
    const message: BackgroundJobMessage = {
      jobId: job.id,
      orgId,
      userId,
      createdBy: { type: 'system', ref: null, issuer: null },
      request,
    }
    const ack = vi.fn()

    await worker.queue({ messages: [{ body: message, ack }] } as unknown as MessageBatch<BackgroundJobMessage>, testEnv)

    expect(ack).toHaveBeenCalledOnce()
    const index = await matters.findActiveConflict(orgId, libraryPath, 'library.json')
    if (!index) throw new Error('library.json not written')
    expect(index.id).toBe(seededIndex.id)
    const bytes = objects.get(index.object)
    if (!bytes) throw new Error('index object missing')
    const text = new TextDecoder().decode(bytes)
    return {
      library,
      index,
      text,
      feed: mediaLibraryFeedSchema.parse(JSON.parse(text)),
      job: await createBackgroundJobRepo(db).get(orgId, job.id),
    }
  }

  return { db, orgId, storageId, add, addFolders, scan }
}

describe('[CF] media library scans on the Workers queue', () => {
  it.each(
    LIBRARY_PATHS,
  )('routes a scan message through the queue consumer for %s [spec: media-library/queue-consumer]', async (libraryPath) => {
    const { db, orgId, add, addFolders, scan } = await seedWorkspace()
    const folderId = await addFolders(libraryPath)
    const direct = await add(libraryPath, 'Inception (2010).mkv')
    const nested = await add(`${libraryPath}/Show/Season 1`, 'S01E01.mkv')
    for (const outside of [
      `${libraryPath}-sibling`,
      `${libraryPath}0`,
      `${libraryPath.replaceAll('_', 'X').replaceAll('%', 'Y')}/sub`,
    ]) {
      await add(outside, 'Outside.2020.mkv')
    }

    const { library, job, feed } = await scan(libraryPath, folderId)

    expect(job).toMatchObject({ status: 'completed', errorMessage: null, progress: { fileCount: 2 } })
    expect(feed.items.map((item) => item.id)).toEqual([direct.id, nested.id])
    const stored = await createMediaLibraryRepo(db).get(orgId, library.id)
    expect(stored).toMatchObject({ fingerprint: expect.stringMatching(/^2:/), scanning: false })
  })

  it('writes one feed with every video in folder-then-name order for a library larger than a listing page [spec: media-library/large-library-single-index]', async () => {
    const { db, orgId, storageId, addFolders, scan } = await seedWorkspace()
    const libraryPath = 'Media/Movies'
    const folderId = await addFolders(libraryPath)
    const count = 2500
    // Shelves interleave with insertion order, and "Shelf 1/x" vs "Shelf 1-b"
    // differs between (parent, name) order and full-path order.
    const shelves = ['Shelf 1', 'Shelf 1-b', 'Shelf 2/Disc A', 'Shelf 2', '影集']
    const now = Date.now()
    // D1 binds numbers as REAL, so the integers that build names and JSON paths are inlined.
    await db.run(sql`
      WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i + 1 < ${sql.raw(String(count))})
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      SELECT 'video-' || i, ${orgId}, 'alias-' || ${orgId} || '-' || i, printf('Movie %05d (2010).mkv', ${sql.raw(String(count))} - i),
        'application/octet-stream', 100, ${DirType.FILE},
        ${libraryPath} || '/' || json_extract(${JSON.stringify(shelves)}, '$[' || (i % ${sql.raw(String(shelves.length))}) || ']'),
        'objects/video-' || i, ${storageId}, 'active', ${now}, ${now}
      FROM n
    `)
    const encoder = new TextEncoder()
    const bytesBefore = (a: string, b: string) => Buffer.compare(encoder.encode(a), encoder.encode(b))
    const expected = Array.from({ length: count }, (_, i) => ({
      id: `video-${i}`,
      parent: `${libraryPath}/${shelves[i % shelves.length]}`,
      name: `Movie ${String(count - i).padStart(5, '0')} (2010).mkv`,
    }))
      .sort((a, b) => bytesBefore(a.parent, b.parent) || bytesBefore(a.name, b.name))
      .map((file) => file.id)

    const { job, feed, index, text } = await scan(libraryPath, folderId)

    expect(job).toMatchObject({ status: 'completed', resultMetadata: { itemCount: count } })
    expect(feed.items.map((item) => item.id)).toEqual(expected)
    expect(text).toBe(JSON.stringify(feed))
    expect(index.size).toBe(encoder.encode(text).byteLength)
  })
})
