import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SystemOptionsRepo, TmdbAuthError, TmdbRateLimitError, TmdbUnavailableError } from '../../usecases/ports'
import { createTmdbGateway } from './tmdb'

function options(values: Record<string, string>): SystemOptionsRepo {
  return {
    get: async () => null,
    getValue: async (key) => values[key] ?? null,
    getMany: async (keys) => keys.flatMap((key) => (key in values ? [{ key, value: values[key] }] : [])),
    listByPrefix: async () => [],
    set: async () => {},
    setMany: async () => {},
    delete: async () => {},
  }
}

function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next instanceof Error) throw next
    return next
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'Content-Type': 'application/json' } })
}

const gateway = createTmdbGateway(options({}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TMDB gateway', () => {
  it('reads the access token and language, defaulting to en-US, and is unconfigured without a token [spec: media-scraping/tmdb-gateway]', async () => {
    await expect(createTmdbGateway(options({})).getConfig()).resolves.toBeNull()
    await expect(
      createTmdbGateway(
        options({ media_scraper_tmdb_access_token: '  ', media_scraper_language: 'ja-JP' }),
      ).getConfig(),
    ).resolves.toBeNull()
    await expect(
      createTmdbGateway(options({ media_scraper_tmdb_access_token: ' token ' })).getConfig(),
    ).resolves.toEqual({ accessToken: 'token', language: 'en-US' })
    await expect(
      createTmdbGateway(
        options({ media_scraper_tmdb_access_token: 'token', media_scraper_language: 'zh-CN' }),
      ).getConfig(),
    ).resolves.toEqual({ accessToken: 'token', language: 'zh-CN' })
  })

  it('searches movies and shows with the bearer token and maps the results [spec: media-scraping/tmdb-gateway]', async () => {
    const fetchMock = stubFetch(
      json({
        results: [
          { id: 27205, title: '盗梦空间', original_title: 'Inception', release_date: '2010-07-15' },
          { id: 1, title: 'Untitled', original_title: null, release_date: '' },
        ],
      }),
      json({
        results: [
          { id: 1399, name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17' },
        ],
      }),
    )

    await expect(gateway.searchMovies('token', { title: 'Inception', year: 2010 }, 'zh-CN')).resolves.toEqual([
      { id: 27205, title: '盗梦空间', originalTitle: 'Inception', year: 2010 },
      { id: 1, title: 'Untitled', originalTitle: '', year: null },
    ])
    await expect(gateway.searchShows('token', { title: 'Game of Thrones' }, 'en-US')).resolves.toEqual([
      { id: 1399, title: 'Game of Thrones', originalTitle: 'Game of Thrones', year: 2011 },
    ])

    const [movieUrl, movieInit] = fetchMock.mock.calls[0]
    const movie = new URL(movieUrl)
    expect(movie.origin + movie.pathname).toBe('https://api.themoviedb.org/3/search/movie')
    expect(Object.fromEntries(movie.searchParams)).toEqual({
      query: 'Inception',
      year: '2010',
      language: 'zh-CN',
      include_adult: 'false',
    })
    expect(movieInit?.headers).toMatchObject({ Authorization: 'Bearer token' })
    const show = new URL(fetchMock.mock.calls[1][0])
    expect(show.pathname).toBe('/3/search/tv')
    expect(show.searchParams.has('first_air_date_year')).toBe(false)
  })

  it('fetches details with images in the configured language, textless, and English [spec: media-scraping/tmdb-gateway]', async () => {
    const fetchMock = stubFetch(
      json({
        id: 27205,
        title: '盗梦空间',
        original_title: 'Inception',
        overview: '',
        release_date: '2010-07-15',
        runtime: 148,
        genres: [{ id: 28, name: '动作' }],
        poster_path: '/default.jpg',
        backdrop_path: null,
        images: {
          posters: [{ file_path: '/zh.jpg', iso_639_1: 'zh' }],
          backdrops: [{ file_path: '/textless.jpg', iso_639_1: null }],
        },
      }),
      json({ id: 27205, title: 'Inception', original_title: 'Inception', overview: 'A thief.' }),
    )

    await expect(gateway.getMovie('token', 27205, 'zh-CN', { images: true })).resolves.toEqual({
      id: 27205,
      title: '盗梦空间',
      originalTitle: 'Inception',
      overview: '',
      date: '2010-07-15',
      runtime: 148,
      genres: ['动作'],
      posterPath: '/default.jpg',
      backdropPath: null,
      posters: [{ path: '/zh.jpg', language: 'zh' }],
      backdrops: [{ path: '/textless.jpg', language: null }],
    })
    await expect(gateway.getMovie('token', 27205, 'en-US', { images: false })).resolves.toMatchObject({
      overview: 'A thief.',
      posters: [],
    })

    expect(Object.fromEntries(new URL(fetchMock.mock.calls[0][0]).searchParams)).toEqual({
      language: 'zh-CN',
      append_to_response: 'images',
      include_image_language: 'zh,null,en',
    })
    expect(Object.fromEntries(new URL(fetchMock.mock.calls[1][0]).searchParams)).toEqual({ language: 'en-US' })
  })

  it('maps a season and its episodes [spec: media-scraping/tmdb-gateway]', async () => {
    const fetchMock = stubFetch(
      json({
        season_number: 1,
        poster_path: '/s1.jpg',
        episodes: [
          {
            id: 63056,
            season_number: 1,
            episode_number: 2,
            name: 'The Kingsroad',
            overview: 'Overview',
            air_date: '2011-04-24',
            still_path: '/still.jpg',
          },
        ],
      }),
    )

    await expect(gateway.getSeason('token', 1399, 1, 'en-US')).resolves.toEqual({
      season: 1,
      posterPath: '/s1.jpg',
      episodes: [
        {
          id: 63056,
          season: 1,
          episode: 2,
          title: 'The Kingsroad',
          overview: 'Overview',
          airDate: '2011-04-24',
          stillPath: '/still.jpg',
        },
      ],
    })
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/3/tv/1399/season/1')
  })

  it('downloads images from the image host and returns null for a missing one [spec: media-scraping/tmdb-gateway]', async () => {
    const fetchMock = stubFetch(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } }),
      new Response('missing', { status: 404 }),
    )

    const image = await gateway.getImage('/poster.jpg', 'w780')
    expect(image?.contentType).toBe('image/jpeg')
    expect(Array.from(image?.bytes ?? [])).toEqual([1, 2, 3])
    await expect(gateway.getImage('/gone.jpg', 'w300')).resolves.toBeNull()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://image.tmdb.org/t/p/w780/poster.jpg',
      'https://image.tmdb.org/t/p/w300/gone.jpg',
    ])
  })

  it('maps TMDB failures to typed errors [spec: media-scraping/tmdb-gateway]', async () => {
    stubFetch(
      new Response('{}', { status: 404 }),
      new Response('{}', { status: 401 }),
      new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
      new Response('{}', { status: 429 }),
      new Response('{}', { status: 503 }),
      new TypeError('network down'),
      new Response('{}', { status: 422 }),
    )

    await expect(gateway.getShow('token', 1, 'en-US', { images: true })).resolves.toBeNull()
    await expect(gateway.getMovie('token', 1, 'en-US', { images: true })).rejects.toBeInstanceOf(TmdbAuthError)
    await expect(gateway.searchMovies('token', { title: 'x' }, 'en-US')).rejects.toMatchObject({
      name: 'TmdbRateLimitError',
      retryAfterSeconds: 7,
    })
    await expect(gateway.searchMovies('token', { title: 'x' }, 'en-US')).rejects.toEqual(new TmdbRateLimitError(10))
    await expect(gateway.searchShows('token', { title: 'x' }, 'en-US')).rejects.toBeInstanceOf(TmdbUnavailableError)
    await expect(gateway.getSeason('token', 1, 1, 'en-US')).rejects.toBeInstanceOf(TmdbUnavailableError)
    await expect(gateway.searchMovies('token', { title: '' }, 'en-US')).rejects.toThrow('HTTP 422')
  })
})
