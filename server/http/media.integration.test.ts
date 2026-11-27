import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createMatterRepo } from '../adapters/repos/matter.js'
import { adminHeaders, createTestApp } from '../test/setup.js'
import { mintTaskUploadContext } from '../test/task-upload.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

const STORAGE_ID = 'media-storage'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignInline').mockImplementation(
    async (_storage, key) => `https://images.example.com/${key}`,
  )
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({
    size: 10,
    contentType: 'video/x-matroska',
    etag: 'abc',
  })
})

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (
      id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, enabled, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKIA', 'secret', '', '',
      0, 0, 1, 'untested', 0, ${100 * 1024 ** 2}, 1, ${now}, ${now})
  `)
}

async function insertMatter(
  db: TestDb,
  orgId: string,
  opts: {
    id: string
    name: string
    parent?: string
    folder?: boolean
    type?: string
    metadata?: unknown
    createdAt?: number
    trashedAt?: number
  },
) {
  const created = opts.createdAt ?? Math.floor(Date.now() / 1000)
  await db.run(sql`
    INSERT INTO matters (
      id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, metadata,
      created_at, updated_at
    )
    VALUES (
      ${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name},
      ${opts.folder ? 'folder' : (opts.type ?? 'video/x-matroska')}, 10, ${opts.folder ? 1 : 0}, ${opts.parent ?? ''},
      ${opts.folder ? '' : `key/${opts.id}`}, ${STORAGE_ID}, 'active', ${opts.trashedAt ?? null},
      ${opts.metadata === undefined ? null : JSON.stringify(opts.metadata)}, ${created}, ${created}
    )
  `)
}

async function metadataOf(db: TestDb, id: string): Promise<unknown> {
  const rows = await db.all<{ metadata: string | null }>(sql`SELECT metadata FROM matters WHERE id = ${id}`)
  return rows[0]?.metadata ? JSON.parse(rows[0].metadata) : null
}

async function updatedAtOf(db: TestDb, id: string): Promise<number> {
  const rows = await db.all<{ updatedAt: number }>(sql`SELECT updated_at AS updatedAt FROM matters WHERE id = ${id}`)
  return rows[0].updatedAt
}

function movie(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'movie',
    tmdb: { id: 10378, type: 'movie' },
    title: 'Big Buck Bunny',
    originalTitle: 'Big Buck Bunny',
    year: 2008,
    overview: 'A giant rabbit.',
    genres: ['Animation', 'Comedy'],
    runtime: 10,
    ...overrides,
  }
}

async function uploadAsTask(app: TestApp, token: string, body: Record<string, unknown>): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const createRes = await app.request('/api/objects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 'video/x-matroska', size: 10, dirtype: 0, onConflict: 'fail', ...body }),
  })
  expect(createRes.status).toBe(201)
  const created = (await createRes.json()) as { id: string; upload?: { sessionId: string } }
  if (!created.upload) return created.id
  const completeRes = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
  })
  expect(completeRes.status).toBe(200)
  return created.id
}

function putMedia(app: TestApp, token: string, id: string, media: unknown) {
  return app.request(`/api/objects/${id}/metadata/media`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(media),
  })
}

async function setup() {
  const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
  await insertStorage(db)
  const task = await mintTaskUploadContext(app, db, { targetFolder: 'Movies' })
  return { app, db, ...task }
}

describe('task media metadata [spec: file-metadata/task-write]', () => {
  it('lets a task set media on the objects it uploaded and bumps their updatedAt', async () => {
    const { app, db, uploadToken } = await setup()
    const folderId = await uploadAsTask(app, uploadToken, {
      name: 'Big Buck Bunny (2008)',
      type: 'folder',
      dirtype: 1,
      parent: 'Movies',
    })
    const videoId = await uploadAsTask(app, uploadToken, { name: 'bbb.mkv', parent: 'Movies/Big Buck Bunny (2008)' })
    await db.run(sql`UPDATE matters SET updated_at = 1 WHERE id = ${videoId}`)

    const media = movie({ poster: folderId })
    const res = await putMedia(app, uploadToken, videoId, media)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(media)
    expect(await metadataOf(db, videoId)).toEqual({ media })
    expect(await updatedAtOf(db, videoId)).toBeGreaterThan(1)

    // The task may correct what it wrote.
    expect((await putMedia(app, uploadToken, videoId, movie({ title: 'Big Buck Bunny 2' }))).status).toBe(200)
    expect(await metadataOf(db, videoId)).toMatchObject({ media: { title: 'Big Buck Bunny 2' } })
  })

  it('refuses objects the task did not upload, objects outside its folder, and other callers', async () => {
    const { app, db, uploadToken, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'mine-not', name: 'user.mkv', parent: 'Movies' })
    await insertMatter(db, orgId, { id: 'elsewhere', name: 'x.mkv', parent: 'Elsewhere' })

    expect((await putMedia(app, uploadToken, 'mine-not', movie())).status).toBe(403)
    expect((await putMedia(app, uploadToken, 'elsewhere', movie())).status).toBe(403)
    expect((await putMedia(app, uploadToken, 'missing-object', movie())).status).toBe(404)
    expect(await metadataOf(db, 'mine-not')).toBeNull()

    const session = await adminHeaders(app)
    const userRes = await app.request('/api/objects/mine-not/metadata/media', {
      method: 'PUT',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify(movie()),
    })
    expect(userRes.status).toBe(403)
  })

  it('sets media on a reused folder only while it has none', async () => {
    const { app, db, uploadToken, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'show-folder', name: 'Show (2020)', parent: 'Movies', folder: true })
    const show = { kind: 'tvshow', tmdb: { id: 1399, type: 'tv' }, title: 'Show' }

    expect((await putMedia(app, uploadToken, 'show-folder', show)).status).toBe(200)
    expect((await putMedia(app, uploadToken, 'show-folder', { ...show, title: 'Other' })).status).toBe(409)
    expect(await metadataOf(db, 'show-folder')).toEqual({ media: show })
  })

  it('rejects media that breaks the schema or exceeds 16 KB', async () => {
    const { app, uploadToken } = await setup()
    const videoId = await uploadAsTask(app, uploadToken, { name: 'v.mkv', parent: 'Movies' })

    expect((await putMedia(app, uploadToken, videoId, { kind: 'movie', title: 'x' })).status).toBe(400)
    expect((await putMedia(app, uploadToken, videoId, movie({ extra: true }))).status).toBe(400)
    // 8,000 CJK characters are 24 KB of UTF-8.
    const huge = movie({ overview: '中'.repeat(8000) })
    expect((await putMedia(app, uploadToken, videoId, huge)).status).toBe(400)
  })
})

describe('task upload token reads [spec: download-scraping/movie-folder-reused]', () => {
  it('finds an entry by name, case-insensitively, inside the target folder only', async () => {
    const { app, db, uploadToken, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'bbb-folder', name: 'Big Buck Bunny (2008)', parent: 'Movies', folder: true })
    await insertMatter(db, orgId, { id: 'other', name: 'Sintel (2010)', parent: 'Movies', folder: true })
    const headers = { Authorization: `Bearer ${uploadToken}` }

    const found = await app.request('/api/objects?parent=Movies&name=big%20buck%20bunny%20(2008)', { headers })
    expect(found.status).toBe(200)
    const page = (await found.json()) as { items: { id: string }[] }
    expect(page.items.map((item) => item.id)).toEqual(['bbb-folder'])

    expect((await app.request('/api/objects?parent=Elsewhere', { headers })).status).toBe(403)
    expect((await app.request('/api/objects?parent=Movies&search=Sintel', { headers })).status).toBe(403)
    expect((await app.request('/api/objects/bbb-folder', { headers })).status).toBe(403)
    expect((await app.request('/api/trash/objects', { headers })).status).toBe(403)
    expect((await app.request('/api/media/movies', { headers })).status).toBe(403)
  })
})

describe('metadata lifecycle [spec: file-metadata/task-write]', () => {
  it('keeps metadata through rename, move, trash, and restore; copies it; clears it on overwrite', async () => {
    const { app, db, orgId } = await setup()
    const media = movie()
    await insertMatter(db, orgId, { id: 'folder-a', name: 'A', folder: true })
    await insertMatter(db, orgId, { id: 'video', name: 'v.mkv', metadata: { media } })
    const headers = { ...(await adminHeaders(app)), 'Content-Type': 'application/json' }

    const rename = await app.request('/api/objects/video', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'renamed.mkv' }),
    })
    expect(rename.status).toBe(200)
    const move = await app.request('/api/objects/video', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ parent: 'A' }),
    })
    expect(move.status).toBe(200)
    expect((await app.request('/api/objects/video', { method: 'DELETE', headers })).status).toBe(204)
    const restore = await app.request('/api/trash/objects/video/restorations', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    expect(restore.status).toBe(200)
    expect(await metadataOf(db, 'video')).toEqual({ media })

    const copy = await app.request('/api/objects/video/copies', {
      method: 'POST',
      headers,
      body: JSON.stringify({ parent: '' }),
    })
    expect(copy.status).toBe(201)
    const copied = (await copy.json()) as { id: string }
    expect(await metadataOf(db, copied.id)).toEqual({ media })

    const repo = createMatterRepo(db)
    const matter = await repo.get('video', orgId)
    if (!matter) throw new Error('video missing')
    await repo.applyUpload(orgId, matter, { type: 'video/mp4', size: 20, object: 'key/new' })
    expect(await metadataOf(db, 'video')).toBeNull()
    expect(await metadataOf(db, copied.id)).toEqual({ media })
  })
})

describe('GET /api/media/movies [spec: media-catalog/movies]', () => {
  it('lists scraped movies newest first, paged, with poster URLs for live posters', async () => {
    const { app, db, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'poster-old', name: 'old-poster.jpg', parent: 'M', type: 'image/jpeg' })
    await insertMatter(db, orgId, {
      id: 'poster-gone',
      name: 'gone-poster.jpg',
      parent: 'M',
      type: 'image/jpeg',
      trashedAt: Date.now(),
    })
    await insertMatter(db, orgId, {
      id: 'movie-old',
      name: 'old.mkv',
      parent: 'M',
      createdAt: 1000,
      metadata: { media: movie({ title: 'Old', poster: 'poster-old', fanart: 'fanart-x' }) },
    })
    await insertMatter(db, orgId, {
      id: 'movie-new',
      name: 'new.mkv',
      parent: 'M/New (2024)',
      createdAt: 2000,
      metadata: { media: movie({ title: 'New', poster: 'poster-gone' }) },
    })
    await insertMatter(db, orgId, {
      id: 'show',
      name: 'Show',
      folder: true,
      createdAt: 3000,
      metadata: { media: { kind: 'tvshow', tmdb: { id: 1, type: 'tv' }, title: 'Show' } },
    })
    await insertMatter(db, orgId, {
      id: 'trashed-movie',
      name: 't.mkv',
      createdAt: 4000,
      trashedAt: Date.now(),
      metadata: { media: movie() },
    })
    await insertMatter(db, orgId, { id: 'plain', name: 'plain.mkv', createdAt: 5000 })
    const headers = await adminHeaders(app)

    const first = await app.request('/api/media/movies?pageSize=1', { headers })
    expect(first.status).toBe(200)
    const firstPage = (await first.json()) as { items: Record<string, unknown>[]; nextPageToken: string | null }
    expect(firstPage.items).toEqual([
      { id: 'movie-new', path: 'M/New (2024)/new.mkv', media: movie({ title: 'New', poster: 'poster-gone' }) },
    ])
    expect(firstPage.nextPageToken).toEqual(expect.any(String))

    const second = await app.request(`/api/media/movies?pageSize=1&pageToken=${firstPage.nextPageToken}`, { headers })
    const secondPage = (await second.json()) as { items: Record<string, unknown>[]; nextPageToken: string | null }
    expect(secondPage.items).toEqual([
      {
        id: 'movie-old',
        path: 'M/old.mkv',
        media: movie({ title: 'Old', poster: 'poster-old', fanart: 'fanart-x' }),
        posterUrl: 'https://images.example.com/key/poster-old',
      },
    ])
    expect(secondPage.nextPageToken).toBeNull()
  })

  it('uses the media kind index', async () => {
    const { db } = await setup()
    const plan = await db.all<{ detail: string }>(sql`
      EXPLAIN QUERY PLAN SELECT id FROM matters
      WHERE org_id = 'o' AND metadata ->> '$.media.kind' = 'movie'
        AND status = 'active' AND trashed_at IS NULL AND purged_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 25
    `)
    expect(plan.map((row) => row.detail).join('\n')).toContain('matters_media_kind_idx')
  })
})

describe('scrape skipped activity [spec: download-scraping/fallback]', () => {
  it('records why a download was uploaded without scraping in the task timeline', async () => {
    const { app, taskId, downloaderToken } = await setup()
    const patch = await app.request(`/api/downloads/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${downloaderToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrapeSkippedReason: 'TMDB rejected the access token' }),
    })
    expect(patch.status).toBe(200)
    await expect(patch.json()).resolves.toMatchObject({ status: { state: 'assigned', error: null } })

    const timeline = await app.request(`/api/downloads/tasks/${taskId}/events`, { headers: await adminHeaders(app) })
    const body = (await timeline.json()) as { items: { action: string; detail: string | null; severity: string }[] }
    expect(body.items).toContainEqual(
      expect.objectContaining({
        action: 'download_task_scrape_skipped',
        detail: 'TMDB rejected the access token',
        severity: 'warning',
      }),
    )
  })
})
