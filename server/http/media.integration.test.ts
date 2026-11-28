import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createMatterRepo } from '../adapters/repos/matter.js'
import { adminHeaders, createTestApp } from '../test/setup.js'
import { mintSiblingTaskUploadToken, mintTaskUploadContext } from '../test/task-upload.js'

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

  it('refuses a file another task of the same downloader uploaded into the shared folder', async () => {
    const context = await setup()
    const { app, db, uploadToken } = context
    const sibling = await mintSiblingTaskUploadToken(app, context)
    const siblingVideo = await uploadAsTask(app, sibling.uploadToken, { name: 'sibling.mkv', parent: 'Movies' })

    expect((await putMedia(app, uploadToken, siblingVideo, movie())).status).toBe(403)
    expect(await metadataOf(db, siblingVideo)).toBeNull()
    expect((await putMedia(app, sibling.uploadToken, siblingVideo, movie())).status).toBe(200)
  })

  it('keeps the device-and-assignment rule for a file created before matters recorded their task', async () => {
    const { app, db, uploadToken } = await setup()
    const videoId = await uploadAsTask(app, uploadToken, { name: 'legacy.mkv', parent: 'Movies' })
    await db.run(sql`UPDATE matters SET created_by_task_id = NULL WHERE id = ${videoId}`)

    expect((await putMedia(app, uploadToken, videoId, movie())).status).toBe(200)
    expect(await metadataOf(db, videoId)).toEqual({ media: movie() })
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

type Page = { items: { id: string }[]; nextPageToken: string | null }

describe('GET /api/media/movies/{id} [spec: media-catalog/movie-link]', () => {
  it('returns one movie with its poster URL, and 404 for anything that is not a live movie', async () => {
    const { app, db, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'poster', name: 'poster.jpg', parent: 'M', type: 'image/jpeg' })
    await insertMatter(db, orgId, {
      id: 'movie-1',
      name: 'bbb.mkv',
      parent: 'M',
      metadata: { media: movie({ poster: 'poster' }) },
    })
    await insertMatter(db, orgId, { id: 'trashed', name: 't.mkv', trashedAt: Date.now(), metadata: { media: movie() } })
    await insertMatter(db, orgId, { id: 'plain', name: 'plain.mkv' })
    await insertMatter(db, orgId, {
      id: 'a-show',
      name: 'Show',
      folder: true,
      metadata: { media: { kind: 'tvshow', tmdb: { id: 1, type: 'tv' }, title: 'Show' } },
    })
    const headers = await adminHeaders(app)

    const res = await app.request('/api/media/movies/movie-1', { headers })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      id: 'movie-1',
      path: 'M/bbb.mkv',
      media: movie({ poster: 'poster' }),
      posterUrl: 'https://images.example.com/key/poster',
    })
    for (const id of ['trashed', 'plain', 'a-show', 'missing']) {
      expect((await app.request(`/api/media/movies/${id}`, { headers })).status).toBe(404)
    }
  })
})

describe('GET /api/media/movies?search [spec: media-catalog/search]', () => {
  it('keeps the movies whose title or original title contains the search, ignoring case, paged', async () => {
    const { app, db, orgId } = await setup()
    const titles = [
      ['m1', 'The Matrix', 'The Matrix'],
      ['m2', 'Spirited Away', '千と千尋の神隠し'],
      ['m3', 'The Matrix Reloaded', 'The Matrix Reloaded'],
      ['m4', 'Inception', 'Inception'],
      ['m5', '100% Wolf', '100% Wolf'],
    ]
    for (const [i, [id, title, originalTitle]] of titles.entries()) {
      await insertMatter(db, orgId, {
        id,
        name: `${id}.mkv`,
        createdAt: 1000 + i,
        metadata: { media: movie({ title, originalTitle }) },
      })
    }
    const headers = await adminHeaders(app)

    const first = await app.request('/api/media/movies?pageSize=1&search=%20matrix%20', { headers })
    expect(first.status).toBe(200)
    const firstPage = (await first.json()) as Page
    expect(firstPage.items.map((item) => item.id)).toEqual(['m3'])
    const second = await app.request(
      `/api/media/movies?pageSize=1&search=matrix&pageToken=${firstPage.nextPageToken}`,
      { headers },
    )
    const secondPage = (await second.json()) as Page
    expect(secondPage.items.map((item) => item.id)).toEqual(['m1'])
    expect(secondPage.nextPageToken).toBeNull()

    const byOriginal = (await (await app.request('/api/media/movies?search=千尋', { headers })).json()) as Page
    expect(byOriginal.items.map((item) => item.id)).toEqual(['m2'])
    const literal = (await (await app.request('/api/media/movies?search=0%25', { headers })).json()) as Page
    expect(literal.items.map((item) => item.id)).toEqual(['m5'])
    const none = (await (await app.request('/api/media/movies?search=zzz', { headers })).json()) as Page
    expect(none).toEqual({ items: [], nextPageToken: null })

    // A page token belongs to its search.
    const other = await app.request(`/api/media/movies?pageSize=1&search=the&pageToken=${firstPage.nextPageToken}`, {
      headers,
    })
    expect(other.status).toBe(400)
  })
})

describe('GET /api/media/shows?search [spec: media-catalog/search]', () => {
  it('keeps the shows whose title contains the search, paged', async () => {
    const { app, db, orgId } = await setup()
    for (const [i, title] of ['Breaking Bad', 'Better Call Saul', 'Bad Sisters'].entries()) {
      await insertMatter(db, orgId, {
        id: `s${i}`,
        name: title,
        parent: 'TV',
        folder: true,
        createdAt: 1000 + i,
        metadata: { media: { kind: 'tvshow', tmdb: { id: i + 1, type: 'tv' }, title } },
      })
    }
    const headers = await adminHeaders(app)

    const first = (await (await app.request('/api/media/shows?pageSize=1&search=BAD', { headers })).json()) as Page
    expect(first.items.map((item) => item.id)).toEqual(['s2'])
    const second = (await (
      await app.request(`/api/media/shows?pageSize=1&search=BAD&pageToken=${first.nextPageToken}`, { headers })
    ).json()) as Page
    expect(second.items.map((item) => item.id)).toEqual(['s0'])
    expect(second.nextPageToken).toBeNull()
  })
})

function tvshow(overrides: Record<string, unknown> = {}) {
  return { kind: 'tvshow', tmdb: { id: 1396, type: 'tv' }, title: 'Breaking Bad', year: 2008, ...overrides }
}

function episode(season: number, number: number, overrides: Record<string, unknown> = {}) {
  return { kind: 'episode', tmdb: { id: 1396, type: 'tv' }, season, episode: number, ...overrides }
}

describe('GET /api/media/shows [spec: media-catalog/shows]', () => {
  it('lists scraped show folders newest first, paged, with poster URLs', async () => {
    const { app, db, orgId } = await setup()
    await insertMatter(db, orgId, {
      id: 'show-poster',
      name: 'poster.jpg',
      parent: 'TV/Old (2008)',
      type: 'image/jpeg',
    })
    await insertMatter(db, orgId, {
      id: 'show-old',
      name: 'Old (2008)',
      parent: 'TV',
      folder: true,
      createdAt: 1000,
      metadata: { media: tvshow({ title: 'Old', poster: 'show-poster' }) },
    })
    await insertMatter(db, orgId, {
      id: 'show-new',
      name: 'New (2024)',
      parent: 'TV',
      folder: true,
      createdAt: 2000,
      metadata: { media: tvshow({ title: 'New' }) },
    })
    await insertMatter(db, orgId, { id: 'a-movie', name: 'm.mkv', createdAt: 3000, metadata: { media: movie() } })
    await insertMatter(db, orgId, {
      id: 'trashed-show',
      name: 'Gone',
      folder: true,
      createdAt: 4000,
      trashedAt: Date.now(),
      metadata: { media: tvshow() },
    })
    const headers = await adminHeaders(app)

    const first = await app.request('/api/media/shows?pageSize=1', { headers })
    expect(first.status).toBe(200)
    const firstPage = (await first.json()) as { items: Record<string, unknown>[]; nextPageToken: string | null }
    expect(firstPage.items).toEqual([{ id: 'show-new', path: 'TV/New (2024)', media: tvshow({ title: 'New' }) }])

    const second = await app.request(`/api/media/shows?pageSize=1&pageToken=${firstPage.nextPageToken}`, { headers })
    const secondPage = (await second.json()) as { items: Record<string, unknown>[]; nextPageToken: string | null }
    expect(secondPage.items).toEqual([
      {
        id: 'show-old',
        path: 'TV/Old (2008)',
        media: tvshow({ title: 'Old', poster: 'show-poster' }),
        posterUrl: 'https://images.example.com/key/show-poster',
      },
    ])
    expect(secondPage.nextPageToken).toBeNull()

    const one = await app.request('/api/media/shows/show-old', { headers })
    expect(one.status).toBe(200)
    await expect(one.json()).resolves.toEqual(secondPage.items[0])
  })

  it("lists a show's episodes in its subtree by season and episode, paged, with still URLs", async () => {
    const { app, db, orgId } = await setup()
    await insertMatter(db, orgId, {
      id: 'show',
      name: 'BB (2008)',
      parent: 'TV',
      folder: true,
      metadata: { media: tvshow() },
    })
    await insertMatter(db, orgId, {
      id: 'still',
      name: 'e-thumb.jpg',
      parent: 'TV/BB (2008)/Season 01',
      type: 'image/jpeg',
    })
    const episodes: [string, string, number, number][] = [
      ['s2e1', 'TV/BB (2008)/Season 02', 2, 1],
      ['s1e10', 'TV/BB (2008)/Season 01', 1, 10],
      ['s1e2', 'TV/BB (2008)/Season 01', 1, 2],
      ['s0e1', 'TV/BB (2008)/Season 00', 0, 1],
    ]
    for (const [id, parent, season, number] of episodes) {
      await insertMatter(db, orgId, {
        id,
        name: `${id}.mkv`,
        parent,
        metadata: { media: episode(season, number, id === 's1e2' ? { still: 'still', title: 'Two' } : {}) },
      })
    }
    // A sibling folder whose name extends the show's, a trashed episode, and a plain video stay out.
    await insertMatter(db, orgId, {
      id: 'sibling',
      name: 'x.mkv',
      parent: 'TV/BB (2008)-2',
      metadata: { media: episode(1, 1) },
    })
    await insertMatter(db, orgId, {
      id: 'trashed',
      name: 't.mkv',
      parent: 'TV/BB (2008)/Season 01',
      trashedAt: Date.now(),
      metadata: { media: episode(1, 1) },
    })
    await insertMatter(db, orgId, { id: 'plain', name: 'p.mkv', parent: 'TV/BB (2008)/Season 01' })
    const headers = await adminHeaders(app)

    const ids: string[] = []
    let token: string | null = null
    let first: Record<string, unknown>[] = []
    do {
      const query: string = token ? `&pageToken=${token}` : ''
      const res = await app.request(`/api/media/shows/show/episodes?pageSize=2${query}`, { headers })
      expect(res.status).toBe(200)
      const page = (await res.json()) as { items: Record<string, unknown>[]; nextPageToken: string | null }
      if (!token) first = page.items
      ids.push(...page.items.map((item) => item.id as string))
      token = page.nextPageToken
    } while (token)
    expect(ids).toEqual(['s0e1', 's1e2', 's1e10', 's2e1'])
    expect(first[1]).toEqual({
      id: 's1e2',
      path: 'TV/BB (2008)/Season 01/s1e2.mkv',
      media: episode(1, 2, { still: 'still', title: 'Two' }),
      stillUrl: 'https://images.example.com/key/still',
    })
  })

  it('answers 404 for a folder that is not a live show', async () => {
    const { app, db, orgId } = await setup()
    await insertMatter(db, orgId, { id: 'plain-folder', name: 'P', folder: true })
    await insertMatter(db, orgId, { id: 'a-movie', name: 'm.mkv', metadata: { media: movie() } })
    const headers = await adminHeaders(app)
    for (const id of ['plain-folder', 'a-movie', 'missing']) {
      expect((await app.request(`/api/media/shows/${id}/episodes`, { headers })).status).toBe(404)
      expect((await app.request(`/api/media/shows/${id}`, { headers })).status).toBe(404)
    }
  })
})

describe('task media kinds [spec: download-scraping/show-metadata]', () => {
  it('takes show media on folders and episode media on files only', async () => {
    const { app, uploadToken } = await setup()
    const folderId = await uploadAsTask(app, uploadToken, {
      name: 'BB (2008)',
      type: 'folder',
      dirtype: 1,
      parent: 'Movies',
    })
    const videoId = await uploadAsTask(app, uploadToken, { name: 'e.mkv', parent: 'Movies/BB (2008)' })

    expect((await putMedia(app, uploadToken, folderId, episode(1, 1))).status).toBe(400)
    expect((await putMedia(app, uploadToken, videoId, tvshow())).status).toBe(400)
    expect((await putMedia(app, uploadToken, folderId, tvshow())).status).toBe(200)
    expect((await putMedia(app, uploadToken, videoId, episode(1, 1))).status).toBe(200)
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
