// An in-memory TMDB for integration tests, answering the requests the TMDB
// gateway sends through global fetch. Search matches a title substring like
// TMDB's fuzzy search does, so tests exercise ZPan's own result matching. Plots
// exist only in en-US, like an untranslated title.

export interface FakeTmdbMovie {
  id: number
  title: string
  originalTitle?: string
  releaseDate: string
  overview?: string
  posterPath?: string
  backdropPath?: string
}

export interface FakeTmdbShow {
  id: number
  name: string
  firstAirDate: string
  overview?: string
  posterPath?: string
  backdropPath?: string
  seasons: Record<
    number,
    { posterPath?: string; episodes: Array<{ id: number; episode: number; name: string; stillPath?: string }> }
  >
}

export interface FakeTmdb {
  requests: URL[]
  // Requests to api.themoviedb.org, as `path?query` without the language and image params.
  apiCalls(): string[]
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export const FAKE_TMDB_TOKEN = 'fake-tmdb-token'

export function createFakeTmdb(catalog: { movies?: FakeTmdbMovie[]; shows?: FakeTmdbShow[] }): FakeTmdb {
  const movies = catalog.movies ?? []
  const shows = catalog.shows ?? []
  const requests: URL[] = []

  function api(url: URL): Response {
    const plot = (overview: string | undefined) =>
      (url.searchParams.get('language') ?? 'en-US') === 'en-US' ? (overview ?? '') : ''
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const path = url.pathname.replace(/^\/3/, '')
    if (path === '/search/movie') {
      const year = url.searchParams.get('year')
      return json({
        results: movies
          .filter(
            (movie) => movie.title.toLowerCase().includes(query) || movie.originalTitle?.toLowerCase().includes(query),
          )
          .filter((movie) => !year || movie.releaseDate.startsWith(year))
          .map((movie) => ({
            id: movie.id,
            title: movie.title,
            original_title: movie.originalTitle ?? movie.title,
            release_date: movie.releaseDate,
          })),
      })
    }
    if (path === '/search/tv') {
      return json({
        results: shows
          .filter((show) => show.name.toLowerCase().includes(query))
          .map((show) => ({
            id: show.id,
            name: show.name,
            original_name: show.name,
            first_air_date: show.firstAirDate,
          })),
      })
    }
    const movieMatch = /^\/movie\/(\d+)$/.exec(path)
    if (movieMatch) {
      const movie = movies.find((candidate) => candidate.id === Number(movieMatch[1]))
      if (!movie) return json({ status_code: 34 }, 404)
      return json({
        id: movie.id,
        title: movie.title,
        original_title: movie.originalTitle ?? movie.title,
        overview: plot(movie.overview),
        release_date: movie.releaseDate,
        runtime: 120,
        genres: [{ id: 1, name: 'Drama' }],
        poster_path: movie.posterPath ?? null,
        backdrop_path: movie.backdropPath ?? null,
        ...images(url, movie),
      })
    }
    const showMatch = /^\/tv\/(\d+)$/.exec(path)
    if (showMatch) {
      const show = shows.find((candidate) => candidate.id === Number(showMatch[1]))
      if (!show) return json({ status_code: 34 }, 404)
      return json({
        id: show.id,
        name: show.name,
        original_name: show.name,
        overview: plot(show.overview),
        first_air_date: show.firstAirDate,
        genres: [{ id: 2, name: 'Crime' }],
        poster_path: show.posterPath ?? null,
        backdrop_path: show.backdropPath ?? null,
        ...images(url, show),
      })
    }
    const seasonMatch = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path)
    if (seasonMatch) {
      const show = shows.find((candidate) => candidate.id === Number(seasonMatch[1]))
      const seasonNumber = Number(seasonMatch[2])
      const season = show?.seasons[seasonNumber]
      if (!season) return json({ status_code: 34 }, 404)
      return json({
        season_number: seasonNumber,
        poster_path: season.posterPath ?? null,
        episodes: season.episodes.map((episode) => ({
          id: episode.id,
          season_number: seasonNumber,
          episode_number: episode.episode,
          name: episode.name,
          overview: plot(`Plot of ${episode.name}`),
          air_date: '2008-01-20',
          still_path: episode.stillPath ?? null,
        })),
      })
    }
    return json({ status_code: 34 }, 404)
  }

  return {
    requests,
    apiCalls() {
      return requests
        .filter((url) => url.hostname === 'api.themoviedb.org')
        .map((url) => {
          const params = new URLSearchParams(url.searchParams)
          for (const key of ['language', 'append_to_response', 'include_image_language', 'include_adult'])
            params.delete(key)
          const query = params.toString()
          return `${url.pathname.replace(/^\/3/, '')}${query ? `?${query}` : ''}`
        })
    },
    async fetch(input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.hostname === 'image.tmdb.org') {
        requests.push(url)
        return new Response(new TextEncoder().encode(`image ${url.pathname}`), {
          headers: { 'Content-Type': 'image/jpeg' },
        })
      }
      if (url.hostname !== 'api.themoviedb.org') throw new Error(`Unexpected fetch to ${url}`)
      requests.push(url)
      const authorization = new Headers(init?.headers).get('Authorization')
      if (authorization !== `Bearer ${FAKE_TMDB_TOKEN}`) return json({ status_code: 7 }, 401)
      return api(url)
    },
  }
}

function images(url: URL, item: { posterPath?: string; backdropPath?: string }) {
  if (url.searchParams.get('append_to_response') !== 'images') return {}
  return {
    images: {
      posters: item.posterPath ? [{ file_path: item.posterPath, iso_639_1: 'en' }] : [],
      backdrops: item.backdropPath ? [{ file_path: item.backdropPath, iso_639_1: null }] : [],
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
