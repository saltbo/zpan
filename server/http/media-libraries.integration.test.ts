import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import { type MediaLibraryFeed, mediaLibraryFeedSchema } from '@shared/schemas'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3'
import { createBackgroundJobRepo } from '../adapters/repos/background-job'
import { createMatterRepo } from '../adapters/repos/matter'
import { createMediaLibraryRepo } from '../adapters/repos/media-library'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup'
import { sweepMediaLibraries } from '../usecases/media-library-scan'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'media-storage'
const objects = new Map<string, Uint8Array>()

beforeEach(() => {
  objects.clear()
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    objects.set(key, bytes)
    return bytes.byteLength
  })
  vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
    objects.delete(key)
  })
  vi.spyOn(S3Service.prototype, 'getObjectBody').mockImplementation(async (_storage, key) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error(`missing ${key}`)
    return bytes.slice()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function setup(options: { licensed?: boolean; env?: Record<string, string> } = {}) {
  const testApp = await createTestApp(options.env)
  const email = 'media-owner@example.com'
  const session = await authedHeaders(testApp.app, email)
  const [owner] = await testApp.db.all<{ userId: string; orgId: string; slug: string }>(sql`
    SELECT u.id AS userId, o.id AS orgId, o.slug AS slug
    FROM user u
    INNER JOIN member m ON m.user_id = u.id
    INNER JOIN organization o ON o.id = m.organization_id
    WHERE u.email = ${email}
  `)
  const now = Date.now()
  await testApp.db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
  `)
  if (options.licensed ?? true) await seedProLicense(testApp.db)

  const matters = createMatterRepo(testApp.db)
  const add = (parent: string, name: string, kind: 'file' | 'folder' = 'file') =>
    matters.create({
      orgId: owner.orgId,
      name,
      type: kind === 'file' ? 'application/octet-stream' : 'folder',
      size: kind === 'file' ? 1000 + name.length : 0,
      dirtype: kind === 'file' ? DirType.FILE : DirType.USER_FOLDER,
      parent,
      object: kind === 'file' ? `objects/${name}` : '',
      storageId: STORAGE_ID,
      status: 'active',
    })

  return {
    ...testApp,
    ...owner,
    matters,
    add,
    headers: { ...session, 'Content-Type': 'application/json' },
    createLibrary: (folderId: string) =>
      testApp.app.request('/api/media-libraries', {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      }),
  }
}

// Inserts a library row without the create-time checks or a first scan, the
// way a later move or restore can leave libraries.
async function seedLibrary(ctx: Awaited<ReturnType<typeof setup>>, folderId: string, createdAt: Date) {
  const library = await createMediaLibraryRepo(ctx.db).create({
    orgId: ctx.orgId,
    folderId,
    createdByUserId: ctx.userId,
    createdBy: { type: 'user', ref: ctx.userId, issuer: null },
  })
  if (!library) throw new Error('library not created')
  await ctx.db.run(sql`UPDATE media_libraries SET created_at = ${createdAt.getTime()} WHERE id = ${library.id}`)
  return library
}

async function scanJobs(db: TestApp['db'], orgId: string) {
  return (await createBackgroundJobRepo(db).list(orgId, { type: 'media_library_scan', pageSize: 100 })).items
}

async function waitForJob(db: TestApp['db'], orgId: string, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const job = await createBackgroundJobRepo(db).get(orgId, jobId)
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Job ${jobId} did not finish`)
}

async function waitForScans(db: TestApp['db'], orgId: string) {
  const jobs = await scanJobs(db, orgId)
  return Promise.all(jobs.map((job) => waitForJob(db, orgId, job.id)))
}

async function readIndex(ctx: Awaited<ReturnType<typeof setup>>, folderPath: string) {
  const matter = await ctx.matters.findActiveConflict(ctx.orgId, `${folderPath}/.zpan`, 'library.json')
  if (!matter) throw new Error('library.json not found')
  const bytes = objects.get(matter.object)
  if (!bytes) throw new Error(`index object ${matter.object} missing`)
  const feed: MediaLibraryFeed = mediaLibraryFeedSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  return { matter, feed }
}

async function webDavKey(ctx: Awaited<ReturnType<typeof setup>>) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (ctx.auth.api as any).createApiKey({
    body: { configId: 'webdav', userId: ctx.userId, permissions: { objects: ['read'] } },
  })) as { key: string }
  return { Authorization: `Basic ${btoa(`media-owner@example.com:${result.key}`)}` }
}

describe('media libraries API', () => {
  it('marks a folder and writes a JSON Feed index served over WebDAV [spec: media-library/create-and-scan]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    const inception = await ctx.add('Movies', 'Inception (2010).mkv')
    await ctx.add('Movies', 'notes.txt')
    await ctx.add('Movies', 'Shows', 'folder')
    await ctx.add('Movies/Shows', 'Season 1', 'folder')
    const episode = await ctx.add('Movies/Shows/Season 1', 'S01E02.mkv')

    const created = await ctx.createLibrary(movies.id)
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ folderId: movies.id, folderPath: 'Movies', scanning: true })

    const [job] = await waitForScans(ctx.db, ctx.orgId)
    expect(job).toMatchObject({ status: 'completed', progress: { fileCount: 2 } })
    const { matter, feed } = await readIndex(ctx, 'Movies')
    expect(matter).toMatchObject({ type: 'application/feed+json', parent: 'Movies/.zpan' })
    expect(feed.title).toBe('Movies')
    expect(feed.items.map((item) => [item.id, item.attachments[0].url, item._media])).toEqual([
      [inception.id, '../Inception%20(2010).mkv', { type: 'movie', title: 'Inception', year: 2010 }],
      [episode.id, '../Shows/Season%201/S01E02.mkv', { type: 'episode', title: 'Shows', season: 1, episode: 2 }],
    ])

    const list = await ctx.app.request('/api/media-libraries', { headers: ctx.headers })
    const listed = (await list.json()) as { items: { id: string; lastScannedAt: string | null }[] }
    expect(listed.items).toEqual([expect.objectContaining({ folderPath: 'Movies', scanning: false })])
    expect(listed.items[0].lastScannedAt).not.toBeNull()

    const dav = await webDavKey(ctx)
    const first = await ctx.app.request(`/dav/${ctx.slug}/Movies/.zpan/library.json`, { headers: dav })
    expect(first.status).toBe(200)
    expect(mediaLibraryFeedSchema.parse(await first.json()).items).toHaveLength(2)
    const etag = first.headers.get('ETag')
    const revalidated = await ctx.app.request(`/dav/${ctx.slug}/Movies/.zpan/library.json`, {
      headers: { ...dav, 'If-None-Match': etag ?? '' },
    })
    expect(revalidated.status).toBe(304)

    const removed = await ctx.app.request(`/api/media-libraries/${listed.items[0].id}`, {
      method: 'DELETE',
      headers: ctx.headers,
    })
    expect(removed.status).toBe(204)
    const after = (await (await ctx.app.request('/api/media-libraries', { headers: ctx.headers })).json()) as {
      items: unknown[]
    }
    expect(after.items).toEqual([])
    await expect(readIndex(ctx, 'Movies')).resolves.toBeTruthy()
  })

  it('rescans only after the subtree changes and rewrites the index in place [spec: media-library/sweep-rescans-on-change]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    const old = await ctx.add('Movies', 'Old.Movie.1999.mkv')
    expect((await ctx.createLibrary(movies.id)).status).toBe(201)
    await waitForScans(ctx.db, ctx.orgId)
    const before = await readIndex(ctx, 'Movies')

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(1)

    // Age the existing rows so the rename below lands in a later second than
    // anything the first fingerprint saw.
    await ctx.db.run(sql`UPDATE matters SET updated_at = updated_at - 60 WHERE org_id = ${ctx.orgId}`)
    await ctx.matters.update(old.id, ctx.orgId, { name: 'Renamed.Movie.1999.mkv' })
    await ctx.add('Movies', 'Dune (2021).mkv')
    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    const jobs = await waitForScans(ctx.db, ctx.orgId)
    expect(jobs.map((job) => job.status)).toEqual(['completed', 'completed'])

    const after = await readIndex(ctx, 'Movies')
    expect(after.matter.id).toBe(before.matter.id)
    expect(after.matter.size).not.toBe(before.matter.size)
    expect(objects.has(before.matter.object)).toBe(false)
    expect(after.feed.items.map((item) => item.title)).toEqual(['Dune', 'Renamed Movie'])
    expect(await ctx.matters.listActiveDescendants(ctx.orgId, 'Movies')).toEqual([
      expect.objectContaining({ name: 'library.json', parent: 'Movies/.zpan' }),
    ])

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(2)
  })

  it('refuses a rescan while a scan holds the lease [spec: media-library/manual-rescan]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    const created = (await (await ctx.createLibrary(movies.id)).json()) as { id: string }
    await waitForScans(ctx.db, ctx.orgId)

    const queued = await createBackgroundJobRepo(ctx.db).create({
      orgId: ctx.orgId,
      userId: ctx.userId,
      type: 'media_library_scan',
      metadata: { type: 'media_library_scan', libraryId: created.id },
    })
    const rescan = () =>
      ctx.app.request(`/api/media-libraries/${created.id}/scans`, { method: 'POST', headers: ctx.headers })

    const blocked = await rescan()
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ error: { details: [{ reason: 'MEDIA_LIBRARY_SCAN_IN_PROGRESS' }] } })

    await ctx.db.run(
      sql`UPDATE background_jobs SET updated_at = ${Date.now() - 2 * 60 * 60 * 1000} WHERE id = ${queued.id}`,
    )
    const accepted = await rescan()
    expect(accepted.status).toBe(201)
    const job = (await accepted.json()) as { id: string; type: string }
    expect(job.type).toBe('media_library_scan')
    await expect(waitForJob(ctx.db, ctx.orgId, job.id)).resolves.toMatchObject({ status: 'completed' })
  })

  it('rejects overlapping libraries and non-folders [spec: media-library/no-nesting]', async () => {
    const ctx = await setup()
    const media = await ctx.add('', 'Media', 'folder')
    const movies = await ctx.add('Media', 'Movies', 'folder')
    const other = await ctx.add('', 'Other', 'folder')
    const inner = await ctx.add('Other', 'Inner', 'folder')
    const archive = await ctx.add('', 'Archive', 'folder')
    const old = await ctx.add('Archive', 'Old', 'folder')
    const file = await ctx.add('', 'clip.mkv')

    expect((await ctx.createLibrary(media.id)).status).toBe(201)
    expect((await ctx.createLibrary(inner.id)).status).toBe(201)
    expect((await ctx.createLibrary(old.id)).status).toBe(201)
    await ctx.matters.trash(ctx.orgId, old.id)
    const reasons = []
    for (const id of [movies.id, other.id, media.id, archive.id]) {
      const res = await ctx.createLibrary(id)
      expect(res.status).toBe(409)
      reasons.push(((await res.json()) as { error: { details: { reason: string }[] } }).error.details[0].reason)
    }
    expect(reasons).toEqual([
      'MEDIA_LIBRARY_NESTED',
      'MEDIA_LIBRARY_NESTED',
      'MEDIA_LIBRARY_EXISTS',
      'MEDIA_LIBRARY_NESTED',
    ])
    expect((await ctx.createLibrary(file.id)).status).toBe(400)
    expect((await ctx.createLibrary('missing-folder')).status).toBe(404)
  })

  it('skips trashed library folders and drops libraries whose folder was purged [spec: media-library/sweep-lifecycle]', async () => {
    const ctx = await setup()
    const trashed = await ctx.add('', 'Trashed', 'folder')
    const purged = await ctx.add('', 'Purged', 'folder')
    const trashedLibrary = (await (await ctx.createLibrary(trashed.id)).json()) as { id: string }
    const purgedLibrary = (await (await ctx.createLibrary(purged.id)).json()) as { id: string }
    await waitForScans(ctx.db, ctx.orgId)

    await ctx.add('Trashed', 'New.Movie.2024.mkv')
    await ctx.matters.trash(ctx.orgId, trashed.id)
    const purgeIds = (await ctx.matters.collectForPurge(ctx.orgId, purged.id))?.map((matter) => matter.id) ?? []
    await ctx.matters.purge(ctx.orgId, purgeIds)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`library=${purgedLibrary.id}`))

    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(2)
    const libraries = createMediaLibraryRepo(ctx.db)
    await expect(libraries.get(ctx.orgId, trashedLibrary.id)).resolves.toMatchObject({ folder: { trashed: true } })
    await expect(libraries.get(ctx.orgId, purgedLibrary.id)).resolves.toBeNull()
  })

  it('blocks media libraries without a Pro or Business license [spec: media-library/requires-license]', async () => {
    const ctx = await setup({ licensed: false })
    const movies = await ctx.add('', 'Movies', 'folder')

    const create = await ctx.createLibrary(movies.id)
    const list = await ctx.app.request('/api/media-libraries', { headers: ctx.headers })

    expect([create.status, list.status]).toEqual([402, 402])
    expect(await create.json()).toMatchObject({
      error: { details: [{ reason: 'FEATURE_NOT_AVAILABLE', metadata: { feature: 'media_library' } }] },
    })
    expect(await ctx.db.all(sql`SELECT id FROM media_libraries`)).toEqual([])
  })

  it('leaves libraries unscanned when the instance is not entitled [spec: media-library/sweep-requires-license]', async () => {
    const ctx = await setup({ licensed: false })
    const movies = await ctx.add('', 'Movies', 'folder')
    const library = await createMediaLibraryRepo(ctx.db).create({
      orgId: ctx.orgId,
      folderId: movies.id,
      createdByUserId: ctx.userId,
      createdBy: { type: 'user', ref: ctx.userId, issuer: null },
    })
    if (!library) throw new Error('library not created')
    await ctx.add('Movies', 'Dune (2021).mkv')

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })

    expect(await scanJobs(ctx.db, ctx.orgId)).toEqual([])
    await expect(createMediaLibraryRepo(ctx.db).get(ctx.orgId, library.id)).resolves.toMatchObject({
      fingerprint: null,
    })
  })

  it('trusts only certificates from the configured cloud when sweeping [spec: media-library/sweep-requires-license]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    expect((await ctx.createLibrary(movies.id)).status).toBe(201)
    await waitForScans(ctx.db, ctx.orgId)
    await ctx.add('Movies', 'Dune (2021).mkv')

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: 'https://staging-cloud.example' })
    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(1)

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(2)
  })

  it('lets only workspace editors mark folders [spec: media-library/editor-only]', async () => {
    const ctx = await setup()
    const teamId = 'media-team'
    await ctx.db.run(sql`
      INSERT INTO organization (id, name, slug, metadata) VALUES (${teamId}, 'Media Team', ${teamId}, '{"type":"team"}')
    `)
    const viewerEmail = 'media-viewer@example.com'
    const viewerSession = await authedHeaders(ctx.app, viewerEmail)
    await ctx.db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role)
      SELECT 'media-team-viewer', ${teamId}, id, 'viewer' FROM user WHERE email = ${viewerEmail}
    `)
    const active = await ctx.app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...viewerSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: teamId }),
    })
    const cookie = active.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const body = JSON.stringify({ folderId: 'any-folder' })

    const viewer = await ctx.app.request('/api/media-libraries', {
      method: 'POST',
      headers: { ...viewerSession, Cookie: cookie || viewerSession.Cookie, 'Content-Type': 'application/json' },
      body,
    })
    const anonymous = await ctx.app.request('/api/media-libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect([viewer.status, anonymous.status]).toEqual([403, 401])
  })

  it('rejects libraries when background jobs are disabled [spec: media-library/jobs-disabled]', async () => {
    const ctx = await setup({ env: { ZPAN_ARCHIVE_JOBS_ENABLED: 'false' } })
    const movies = await ctx.add('', 'Movies', 'folder')

    expect((await ctx.createLibrary(movies.id)).status).toBe(503)
    expect(await ctx.db.all(sql`SELECT id FROM media_libraries`)).toEqual([])
  })
  it('scans the older of two overlapping libraries and fails the newer one [spec: media-library/overlap-after-move]', async () => {
    const ctx = await setup()
    const media = await ctx.add('', 'Media', 'folder')
    const movies = await ctx.add('Media', 'Movies', 'folder')
    await ctx.add('Media/Movies', 'Dune (2021).mkv')
    const older = await seedLibrary(ctx, media.id, new Date(Date.now() - 60_000))
    const newer = await seedLibrary(ctx, movies.id, new Date())

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    const jobs = await waitForScans(ctx.db, ctx.orgId)

    const jobFor = (libraryId: string) => jobs.find((job) => job.metadata?.libraryId === libraryId)
    expect(jobFor(older.id)).toMatchObject({ status: 'completed' })
    expect(jobFor(newer.id)).toMatchObject({
      status: 'failed',
      errorMessage: 'Media library overlaps the older media library at "Media"',
    })
    expect((await readIndex(ctx, 'Media')).feed.items.map((item) => item.title)).toEqual(['Dune'])
    await expect(readIndex(ctx, 'Media/Movies')).rejects.toThrow('library.json not found')

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    expect(await scanJobs(ctx.db, ctx.orgId)).toHaveLength(2)
  })

  it('keeps sweeping other libraries when one of them fails [spec: media-library/sweep-isolates-failures]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    const shows = await ctx.add('', 'Shows', 'folder')
    const healthy = await seedLibrary(ctx, movies.id, new Date(Date.now() - 60_000))
    const broken = await seedLibrary(ctx, shows.id, new Date())
    const fingerprint = ctx.deps.mediaLibraries.fingerprint
    vi.spyOn(ctx.deps.mediaLibraries, 'fingerprint').mockImplementation((orgId, path) =>
      path === 'Shows' ? Promise.reject(new Error('D1 unavailable')) : fingerprint(orgId, path),
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })).resolves.toBeUndefined()

    const jobs = await waitForScans(ctx.db, ctx.orgId)
    expect(jobs.map((job) => job.metadata?.libraryId)).toEqual([healthy.id])
    expect(error).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`library=${broken.id}.*D1 unavailable`)))
  })

  it('retries a scan that failed on a transient error at the next sweep [spec: media-library/transient-scan-retry]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    await ctx.add('Movies', 'Dune (2021).mkv')
    vi.mocked(S3Service.prototype.putObject).mockRejectedValueOnce(new Error('S3 unavailable'))

    expect((await ctx.createLibrary(movies.id)).status).toBe(201)
    expect(await waitForScans(ctx.db, ctx.orgId)).toEqual([
      expect.objectContaining({ status: 'failed', errorMessage: 'S3 unavailable' }),
    ])

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    const jobs = await waitForScans(ctx.db, ctx.orgId)
    expect(jobs.map((job) => job.status).sort()).toEqual(['completed', 'failed'])
    expect((await readIndex(ctx, 'Movies')).feed.items.map((item) => item.title)).toEqual(['Dune'])
  })

  it('completes a rescan when the previous index object cannot be deleted [spec: media-library/index-cleanup-failure]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    expect((await ctx.createLibrary(movies.id)).status).toBe(201)
    await waitForScans(ctx.db, ctx.orgId)
    const before = await readIndex(ctx, 'Movies')

    await ctx.add('Movies', 'Dune (2021).mkv')
    vi.mocked(S3Service.prototype.deleteObject).mockRejectedValueOnce(new Error('S3 unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })

    const jobs = await waitForScans(ctx.db, ctx.orgId)
    expect(jobs.map((job) => job.status)).toEqual(['completed', 'completed'])
    expect((await readIndex(ctx, 'Movies')).feed.items.map((item) => item.title)).toEqual(['Dune'])
    expect(error).toHaveBeenCalledWith(expect.stringContaining(before.matter.object))
  })

  it('holds the scan lease through a listing that outlasts it [spec: media-library/scan-holds-lease]', async () => {
    const ctx = await setup()
    const movies = await ctx.add('', 'Movies', 'folder')
    const library = await seedLibrary(ctx, movies.id, new Date())
    const listVideoFiles = ctx.deps.mediaLibraries.listVideoFiles
    vi.spyOn(ctx.deps.mediaLibraries, 'listVideoFiles').mockImplementation(async (...args) => {
      const files = await listVideoFiles(...args)
      await ctx.db.run(sql`UPDATE background_jobs SET updated_at = ${Date.now() - 2 * 60 * 60 * 1000}`)
      return files
    })
    const scanningAtWrite: boolean[] = []
    vi.mocked(S3Service.prototype.putObject).mockImplementationOnce(async () => {
      scanningAtWrite.push((await createMediaLibraryRepo(ctx.db).get(ctx.orgId, library.id))?.scanning ?? false)
      return 0
    })

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    await waitForScans(ctx.db, ctx.orgId)

    expect(scanningAtWrite).toEqual([true])
  })
})
