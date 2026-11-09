import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateId } from '../../shared/ids'
import { S3Service } from '../adapters/gateways/s3'
import { createBackgroundJobRepo } from '../adapters/repos/background-job'
import { createMatterRepo } from '../adapters/repos/matter'
import { createFakeTmdb, FAKE_TMDB_TOKEN, type FakeTmdb } from '../test/fake-tmdb'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup'
import { sweepMediaLibraries } from '../usecases/media-library-scan'
import type { BackgroundJobMessage } from '../usecases/ports'

const STORAGE_ID = 'scrape-storage'
const objects = new Map<string, Uint8Array>()

const catalog = {
  movies: [
    {
      id: 27205,
      title: 'Inception',
      releaseDate: '2010-07-15',
      overview: 'Dreams.',
      posterPath: '/inception.jpg',
      backdropPath: '/inception-bg.jpg',
    },
    {
      id: 329865,
      title: 'Arrival',
      releaseDate: '2016-11-10',
      overview: 'Language.',
      posterPath: '/arrival.jpg',
      backdropPath: '/arrival-bg.jpg',
    },
  ],
  shows: [
    {
      id: 1396,
      name: 'Breaking Bad',
      firstAirDate: '2008-01-20',
      overview: 'Chemistry.',
      posterPath: '/bb.jpg',
      backdropPath: '/bb-bg.jpg',
      seasons: {
        1: {
          posterPath: '/bb-s1.jpg',
          episodes: [
            { id: 62085, episode: 1, name: 'Pilot', stillPath: '/e1.jpg' },
            { id: 62086, episode: 2, name: "Cat's in the Bag...", stillPath: '/e2.jpg' },
          ],
        },
      },
    },
  ],
}

let tmdb: FakeTmdb

beforeEach(() => {
  objects.clear()
  tmdb = createFakeTmdb(catalog)
  vi.stubGlobal('fetch', tmdb.fetch)
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    objects.set(key, bytes)
    return bytes.byteLength
  })
  vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
    objects.delete(key)
  })
  vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_storage, key) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error(`missing ${key}`)
    return bytes.slice()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function setup(options: { licensed?: boolean; token?: string | null; language?: string } = {}) {
  const testApp = await createTestApp()
  const email = 'scrape-owner@example.com'
  const session = await authedHeaders(testApp.app, email)
  const [owner] = await testApp.db.all<{ userId: string; orgId: string }>(sql`
    SELECT u.id AS userId, o.id AS orgId
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
  const token = options.token === undefined ? FAKE_TMDB_TOKEN : options.token
  if (token) {
    await testApp.deps.systemOptions.setMany([
      { key: 'media_scraper_tmdb_access_token', value: token },
      { key: 'media_scraper_language', value: options.language ?? 'en-US' },
    ])
  }

  const matters = createMatterRepo(testApp.db)
  const headers = { ...session, 'Content-Type': 'application/json' }
  const add = (parent: string, name: string, content?: string) => {
    const object = content === undefined ? '' : `objects/${generateId()}`
    if (content !== undefined) objects.set(object, new TextEncoder().encode(content))
    return matters.create({
      orgId: owner.orgId,
      name,
      type: content === undefined ? 'folder' : 'application/octet-stream',
      size: content?.length ?? 0,
      dirtype: content === undefined ? DirType.USER_FOLDER : DirType.FILE,
      parent,
      object,
      storageId: STORAGE_ID,
      status: 'active',
    })
  }
  const video = (parent: string, name: string) => add(parent, name, 'video bytes')

  return {
    ...testApp,
    ...owner,
    matters,
    headers,
    add,
    video,
    request: (path: string, method = 'POST', body?: unknown) =>
      testApp.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    jobs: async (type: string) =>
      (await createBackgroundJobRepo(testApp.db).list(owner.orgId, { type, pageSize: 100 })).items.reverse(),
    // Waits until every queued job, and each job those queue, has finished.
    settle: async () => {
      for (let i = 0; i < 400; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const [active] = await testApp.db.all<{ count: number }>(sql`
          SELECT COUNT(*) AS count FROM background_jobs WHERE org_id = ${owner.orgId} AND status IN ('queued', 'running')
        `)
        if (active.count === 0) return
      }
      throw new Error('background jobs did not settle')
    },
    // Live files by path, with their text.
    files: async () => {
      const rows = await testApp.db.all<{
        id: string
        parent: string
        name: string
        object: string
        actor: string | null
      }>(sql`
        SELECT id, parent, name, object, created_by_actor_type AS actor FROM matters
        WHERE org_id = ${owner.orgId} AND status = 'active' AND trashed_at IS NULL AND dirtype = ${DirType.FILE}
      `)
      return new Map(
        rows.map((row) => [
          `${row.parent}/${row.name}`,
          { ...row, text: new TextDecoder().decode(objects.get(row.object) ?? new Uint8Array()) },
        ]),
      )
    },
  }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function createLibrary(ctx: Ctx, folderId: string): Promise<string> {
  const res = await ctx.request('/api/media-libraries', 'POST', { folderId })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: string }).id
}

// A library with a movie found by search, a movie whose own .nfo names it, an
// unknown movie, and a two-episode show whose folder already has a poster.
async function seedLibrary(ctx: Ctx) {
  const media = await ctx.add('', 'Media')
  await ctx.video('Media', 'Inception (2010).mkv')
  await ctx.video('Media', 'Arrival (2016).mkv')
  await ctx.add(
    'Media',
    'Arrival (2016).nfo',
    '<movie><title>Mine</title><uniqueid type="tmdb">329865</uniqueid></movie>',
  )
  await ctx.video('Media', 'Zzyzx Road (1999).mkv')
  await ctx.add('Media', 'Breaking Bad')
  await ctx.add('Media/Breaking Bad', 'poster.jpg', 'my own poster')
  await ctx.add('Media/Breaking Bad', 'Season 1')
  await ctx.video('Media/Breaking Bad/Season 1', 'Breaking.Bad.S01E01.mkv')
  await ctx.video('Media/Breaking Bad/Season 1', 'Breaking.Bad.S01E02.mkv')
  return media
}

describe('media library scraping', () => {
  it('scrapes after the first scan, writes sidecars without replacing files, and publishes the ids [spec: media-scraping/scrape-library]', async () => {
    const ctx = await setup()
    const media = await seedLibrary(ctx)
    const userFiles = await ctx.files()

    await createLibrary(ctx, media.id)
    await ctx.settle()

    const [scrape] = await ctx.jobs('media_library_scrape')
    expect(scrape).toMatchObject({
      status: 'completed',
      progress: { fileCount: 5 },
      resultMetadata: { matched: 4, unmatched: 1 },
    })
    expect((await ctx.jobs('media_library_scan')).map((job) => job.status)).toEqual(['completed', 'completed'])

    const files = await ctx.files()
    const written = [...files.values()].filter((file) => !userFiles.has(`${file.parent}/${file.name}`))
    expect(written.map((file) => `${file.parent}/${file.name}`).sort()).toEqual(
      [
        'Media/Arrival (2016)-fanart.jpg',
        'Media/Arrival (2016)-poster.jpg',
        'Media/Breaking Bad/Season 1/Breaking.Bad.S01E01-thumb.jpg',
        'Media/Breaking Bad/Season 1/Breaking.Bad.S01E01.nfo',
        'Media/Breaking Bad/Season 1/Breaking.Bad.S01E02-thumb.jpg',
        'Media/Breaking Bad/Season 1/Breaking.Bad.S01E02.nfo',
        'Media/Breaking Bad/fanart.jpg',
        'Media/Breaking Bad/season01-poster.jpg',
        'Media/Breaking Bad/tvshow.nfo',
        'Media/Inception (2010)-fanart.jpg',
        'Media/Inception (2010)-poster.jpg',
        'Media/Inception (2010).nfo',
        'Media/library.json',
      ].sort(),
    )
    expect(written.filter((file) => file.name !== 'library.json').every((file) => file.actor === 'system')).toBe(true)
    for (const [path, file] of userFiles) expect(files.get(path)).toEqual(file)

    expect(files.get('Media/Inception (2010).nfo')?.text).toContain(
      '<movie>\n  <title>Inception</title>\n  <originaltitle>Inception</originaltitle>\n  <year>2010</year>\n  <plot>Dreams.</plot>',
    )
    expect(files.get('Media/Inception (2010).nfo')?.text).toContain(
      '<uniqueid type="tmdb" default="true">27205</uniqueid>',
    )
    expect(files.get('Media/Inception (2010)-poster.jpg')?.text).toBe('image /t/p/w780/inception.jpg')
    expect(files.get('Media/Inception (2010)-fanart.jpg')?.text).toBe('image /t/p/w1280/inception-bg.jpg')
    expect(files.get('Media/Breaking Bad/tvshow.nfo')?.text).toContain(
      '<uniqueid type="tmdb" default="true">1396</uniqueid>',
    )
    expect(files.get('Media/Breaking Bad/season01-poster.jpg')?.text).toBe('image /t/p/w780/bb-s1.jpg')
    const episode = files.get('Media/Breaking Bad/Season 1/Breaking.Bad.S01E02.nfo')?.text
    expect(episode).toContain('<title>Cat&apos;s in the Bag...</title>\n  <season>1</season>\n  <episode>2</episode>')
    expect(episode).toContain('<uniqueid type="tmdb">62086</uniqueid>')
    expect(files.get('Media/Breaking Bad/Season 1/Breaking.Bad.S01E01-thumb.jpg')?.text).toBe('image /t/p/w300/e1.jpg')

    // The .nfo named Arrival, and both episodes shared one show search, show fetch, and season fetch.
    expect(tmdb.apiCalls()).toEqual([
      '/movie/329865',
      '/search/movie?query=Inception&year=2010',
      '/movie/27205',
      '/search/movie?query=Zzyzx+Road&year=1999',
      '/search/movie?query=Zzyzx+Road',
      '/search/tv?query=Breaking+Bad',
      '/tv/1396',
      '/tv/1396/season/1',
    ])

    const rows = await ctx.db.all<{
      status: string
      source: string
      tmdbId: number | null
      episode: number | null
    }>(sql`
      SELECT status, source, tmdb_id AS tmdbId, episode FROM media_scrapes ORDER BY tmdb_id, episode
    `)
    expect(rows).toEqual([
      { status: 'unmatched', source: 'search', tmdbId: null, episode: null },
      { status: 'matched', source: 'search', tmdbId: 1396, episode: 1 },
      { status: 'matched', source: 'search', tmdbId: 1396, episode: 2 },
      { status: 'matched', source: 'search', tmdbId: 27205, episode: null },
      { status: 'matched', source: 'nfo', tmdbId: 329865, episode: null },
    ])
  })

  it('stops once nothing changed: the sweep, a rescan, and a manual scrape find nothing to do [spec: media-scraping/loop-terminates]', async () => {
    const ctx = await setup()
    const media = await seedLibrary(ctx)
    const libraryId = await createLibrary(ctx, media.id)
    await ctx.settle()
    const calls = tmdb.apiCalls().length

    await sweepMediaLibraries(ctx.deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
    await ctx.settle()
    expect(await ctx.jobs('media_library_scan')).toHaveLength(2)

    expect((await ctx.request(`/api/media-libraries/${libraryId}/scans`)).status).toBe(201)
    await ctx.settle()
    expect(await ctx.jobs('media_library_scrape')).toHaveLength(1)

    const manual = await ctx.request(`/api/media-libraries/${libraryId}/scrapes`)
    expect(manual.status).toBe(201)
    await ctx.settle()
    const scrapes = await ctx.jobs('media_library_scrape')
    expect(scrapes.at(-1)).toMatchObject({ status: 'completed', progress: { fileCount: 0 } })
    expect(await ctx.jobs('media_library_scan')).toHaveLength(3)
    expect(tmdb.apiCalls()).toHaveLength(calls)
  })

  it('reuses matches after a rename or a language change and searches again only what did not match [spec: media-scraping/rescrape-changes]', async () => {
    const ctx = await setup()
    const media = await seedLibrary(ctx)
    const libraryId = await createLibrary(ctx, media.id)
    await ctx.settle()
    const before = tmdb.apiCalls().length

    // Age what the scrape saw so the rename lands in a later second.
    await ctx.db.run(sql`UPDATE matters SET updated_at = updated_at - 60 WHERE org_id = ${ctx.orgId}`)
    await ctx.db.run(sql`UPDATE media_scrapes SET file_updated_at = file_updated_at - 60`)
    const [inception] = await ctx.db.all<{ id: string }>(
      sql`SELECT id FROM matters WHERE name = 'Inception (2010).mkv'`,
    )
    await ctx.matters.update(inception.id, ctx.orgId, { name: 'Inception.2010.1080p.mkv' })
    expect((await ctx.request(`/api/media-libraries/${libraryId}/scrapes`)).status).toBe(201)
    await ctx.settle()

    // The parsed title is unchanged, so the match stands; only the renamed video's sidecars are new.
    expect(tmdb.apiCalls().slice(before)).toEqual(['/movie/27205'])
    const files = await ctx.files()
    expect(files.has('Media/Inception.2010.1080p.nfo')).toBe(true)
    expect(files.has('Media/Inception (2010).nfo')).toBe(true)

    await ctx.deps.systemOptions.set('media_scraper_language', 'zh-CN')
    const afterRename = tmdb.apiCalls().length
    expect((await ctx.request(`/api/media-libraries/${libraryId}/scrapes`)).status).toBe(201)
    await ctx.settle()

    expect(await ctx.jobs('media_library_scrape').then((jobs) => jobs.at(-1))).toMatchObject({
      status: 'completed',
      progress: { fileCount: 5 },
    })
    expect(tmdb.apiCalls().slice(afterRename)).toEqual([
      '/search/movie?query=Zzyzx+Road&year=1999',
      '/search/movie?query=Zzyzx+Road',
    ])
    const languages = await ctx.db.all<{ language: string }>(sql`SELECT DISTINCT language FROM media_scrapes`)
    expect(languages).toEqual([{ language: 'zh-CN' }])
  })

  it('continues a scrape across queue messages, a batch of 20 videos at a time [spec: media-scraping/batches]', async () => {
    const ctx = await setup()
    const movies = Array.from({ length: 25 }, (_, i) => ({
      id: 1000 + i,
      title: `Film ${String(i).padStart(2, '0')}`,
      releaseDate: '2001-01-01',
    }))
    tmdb = createFakeTmdb({ movies })
    vi.stubGlobal('fetch', tmdb.fetch)
    const media = await ctx.add('', 'Media')
    for (const movie of movies) await ctx.video('Media', `${movie.title} (2001).mkv`)
    const dispatched: BackgroundJobMessage[] = []
    const dispatch = ctx.deps.jobQueue.dispatch
    vi.spyOn(ctx.deps.jobQueue, 'dispatch').mockImplementation((message, options) => {
      dispatched.push(message)
      return dispatch(message, options)
    })

    await createLibrary(ctx, media.id)
    await ctx.settle()

    const scrapeMessages = dispatched.filter((message) => message.request.type === 'media_library_scrape')
    expect(
      scrapeMessages.map((message) => message.request.type === 'media_library_scrape' && message.request.resume),
    ).toEqual([
      undefined,
      { after: { parent: 'Media', name: 'Film 19 (2001).mkv' }, processed: 20, matched: 20, changed: 20 },
    ])
    expect(new Set(scrapeMessages.map((message) => message.jobId)).size).toBe(1)
    const [job] = await ctx.jobs('media_library_scrape')
    expect(job).toMatchObject({ status: 'completed', progress: { fileCount: 25 }, resultMetadata: { matched: 25 } })
  })

  it('gives loose episodes only their own sidecars, files specials under season00, and never searches unclassified files [spec: media-scraping/show-folders]', async () => {
    const ctx = await setup({ language: 'zh-CN' })
    tmdb = createFakeTmdb({
      shows: [
        ...catalog.shows,
        {
          id: 57243,
          name: 'Doctor Who',
          firstAirDate: '2005-03-26',
          overview: 'A time traveller.',
          posterPath: '/dw.jpg',
          backdropPath: '/dw-bg.jpg',
          seasons: {
            0: { posterPath: '/dw-s0.jpg', episodes: [{ id: 1001, episode: 1, name: 'The Christmas Invasion' }] },
          },
        },
      ],
    })
    vi.stubGlobal('fetch', tmdb.fetch)
    const tv = await ctx.add('', 'TV')
    await ctx.video('TV', 'Breaking.Bad.S01E01.mkv')
    await ctx.video('TV', 'holiday-clip.mov')
    await ctx.add('TV', 'Doctor Who')
    await ctx.add('TV/Doctor Who', 'Specials')
    await ctx.video('TV/Doctor Who/Specials', 'Doctor.Who.S00E01.mkv')

    await createLibrary(ctx, tv.id)
    await ctx.settle()

    const files = await ctx.files()
    expect([...files.keys()].filter((path) => /\.(nfo|jpg)$/.test(path)).sort()).toEqual(
      [
        'TV/Breaking.Bad.S01E01-thumb.jpg',
        'TV/Breaking.Bad.S01E01.nfo',
        'TV/Doctor Who/Specials/Doctor.Who.S00E01.nfo',
        'TV/Doctor Who/fanart.jpg',
        'TV/Doctor Who/poster.jpg',
        'TV/Doctor Who/season00-poster.jpg',
        'TV/Doctor Who/tvshow.nfo',
      ].sort(),
    )
    // Plots missing in zh-CN come from one en-US fetch of the show and of each season.
    expect(files.get('TV/Doctor Who/tvshow.nfo')?.text).toContain('<plot>A time traveller.</plot>')
    expect(files.get('TV/Doctor Who/Specials/Doctor.Who.S00E01.nfo')?.text).toContain(
      '<plot>Plot of The Christmas Invasion</plot>',
    )
    expect(tmdb.apiCalls()).toEqual([
      '/search/tv?query=Breaking+Bad',
      '/tv/1396/season/1',
      '/tv/1396/season/1',
      '/search/tv?query=Doctor+Who',
      '/tv/57243',
      '/tv/57243',
      '/tv/57243/season/0',
      '/tv/57243/season/0',
    ])
    const [unclassified] = await ctx.db.all<{ status: string }>(sql`
      SELECT s.status FROM media_scrapes s JOIN matters m ON m.id = s.matter_id WHERE m.name = 'holiday-clip.mov'
    `)
    expect(unclassified).toEqual({ status: 'unmatched' })
  })

  it('fails with a clear message when TMDB rejects the token [spec: media-scraping/rejected-token]', async () => {
    const ctx = await setup({ token: 'revoked-token' })
    const media = await ctx.add('', 'Media')
    await ctx.video('Media', 'Inception (2010).mkv')

    await createLibrary(ctx, media.id)
    await ctx.settle()

    const [scrape] = await ctx.jobs('media_library_scrape')
    expect(scrape).toMatchObject({
      status: 'failed',
      retryable: false,
      errorMessage: 'TMDB rejected the access token. An administrator can update it in the scraping settings.',
      progress: { currentFilename: 'Media/Inception (2010).mkv' },
    })
    expect(await ctx.db.all(sql`SELECT matter_id FROM media_scrapes`)).toEqual([])
  })

  it('needs a TMDB token: the scan queues no scrape and a manual one is refused [spec: media-scraping/requires-token]', async () => {
    const ctx = await setup({ token: null })
    const media = await ctx.add('', 'Media')
    await ctx.video('Media', 'Inception (2010).mkv')
    const libraryId = await createLibrary(ctx, media.id)
    await ctx.settle()

    expect(await ctx.jobs('media_library_scan')).toEqual([expect.objectContaining({ status: 'completed' })])
    expect(await ctx.jobs('media_library_scrape')).toEqual([])
    const res = await ctx.request(`/api/media-libraries/${libraryId}/scrapes`)
    expect(res.status).toBe(412)
    expect(await res.json()).toMatchObject({
      error: {
        status: 'FAILED_PRECONDITION',
        details: [expect.objectContaining({ reason: 'MEDIA_SCRAPER_NOT_CONFIGURED' })],
      },
    })
    expect(tmdb.requests).toEqual([])
  })

  it('refuses a second scrape while one holds the lease [spec: media-scraping/manual-scrape]', async () => {
    const ctx = await setup()
    const media = await ctx.add('', 'Media')
    const libraryId = await createLibrary(ctx, media.id)
    await ctx.settle()
    await createBackgroundJobRepo(ctx.db).create({
      orgId: ctx.orgId,
      userId: ctx.userId,
      type: 'media_library_scrape',
      metadata: { type: 'media_library_scrape', libraryId },
    })

    const res = await ctx.request(`/api/media-libraries/${libraryId}/scrapes`)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: { details: [expect.objectContaining({ reason: 'MEDIA_LIBRARY_SCRAPE_IN_PROGRESS' })] },
    })
    const listed = (await (await ctx.request('/api/media-libraries', 'GET')).json()) as {
      items: { scraping: boolean }[]
    }
    expect(listed.items).toEqual([expect.objectContaining({ scraping: true })])
  })

  it('is a paid feature [spec: media-scraping/requires-license]', async () => {
    const ctx = await setup({ licensed: false })

    const res = await ctx.request(`/api/media-libraries/${generateId()}/scrapes`)

    expect(res.status).toBe(402)
  })
})
