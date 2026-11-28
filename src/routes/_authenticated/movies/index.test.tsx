import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getMovie, getObject, listMovies, type Movie } from '@/lib/api'
import { MoviesPage } from './index'

type Search = { q?: string; movie?: string }
const search: Search = {}
const navigate = vi.fn((options: { search: Search | ((prev: Search) => Search) }) => {
  const next = typeof options.search === 'function' ? options.search({ ...search }) : options.search
  delete search.q
  delete search.movie
  if (next.q) search.q = next.q
  if (next.movie) search.movie = next.movie
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
  useSearch: () => search,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/useServerEvents', () => ({ useServerEventSubscription: vi.fn() }))
vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }))
vi.mock('@/components/preview/file-preview-dialog', () => ({
  FilePreviewDialog: ({ file, open }: { file: { name: string; downloadUrl: string } | null; open: boolean }) =>
    open && file ? <div role="dialog" aria-label="preview">{`${file.name} ${file.downloadUrl}`}</div> : null,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listMovies: vi.fn(),
  getMovie: vi.fn(),
  getObject: vi.fn(),
}))

const bunny: Movie = {
  id: 'video-1',
  path: 'Movies/Big Buck Bunny (2008)/bbb.mkv',
  posterUrl: 'https://images.example.com/poster.jpg',
  media: {
    kind: 'movie',
    tmdb: { id: 10378, type: 'movie' },
    title: 'Big Buck Bunny',
    year: 2008,
    runtime: 10,
    genres: ['Animation', 'Comedy'],
    overview: 'A giant rabbit.',
    fanart: 'fanart-1',
  },
}
const sintel: Movie = {
  id: 'video-2',
  path: 'Movies/Sintel (2010)/sintel.mkv',
  media: { kind: 'movie', tmdb: { id: 45745, type: 'movie' }, title: 'Sintel', year: 2010 },
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MoviesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  delete search.q
  delete search.movie
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Movies page [spec: media-catalog/broken-poster]', () => {
  it('shows the placeholder when a poster fails to load', async () => {
    vi.mocked(listMovies).mockResolvedValueOnce({ items: [bunny], nextPageToken: null })
    renderPage()

    fireEvent.error(await screen.findByRole('img', { name: 'Big Buck Bunny' }))

    const card = screen.getByRole('button', { name: /Big Buck Bunny/ })
    expect(within(card).queryByRole('img')).toBeNull()
    expect(within(card).getAllByText('Big Buck Bunny')).toHaveLength(2)
  })

  it('shows the plain backdrop when the sheet backdrop fails to load', async () => {
    search.movie = 'video-1'
    vi.mocked(listMovies).mockResolvedValue({
      items: [{ ...bunny, media: { ...bunny.media, fanart: undefined } }],
      nextPageToken: null,
    })
    renderPage()

    const sheet = await screen.findByRole('dialog')
    await vi.waitFor(() => expect(sheet.querySelector('img')).not.toBeNull())
    fireEvent.error(sheet.querySelector('img') as HTMLImageElement)
    expect(sheet.querySelector('img')).toBeNull()
  })
})

describe('Movies page [spec: media-catalog/movies]', () => {
  it('shows scraped movies as posters, with the title on a placeholder when the poster is missing', async () => {
    vi.mocked(listMovies).mockResolvedValueOnce({ items: [bunny, sintel], nextPageToken: null })
    renderPage()

    const poster = await screen.findByRole('img', { name: 'Big Buck Bunny' })
    expect(poster.getAttribute('src')).toBe('https://images.example.com/poster.jpg')
    const sintelCard = screen.getByRole('button', { name: /Sintel/ })
    expect(within(sintelCard).queryByRole('img')).toBeNull()
    expect(within(sintelCard).getAllByText('Sintel')).toHaveLength(2)
    expect(listMovies).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 24 })
  })

  it('opens the selected movie in a sheet with its fanart, facts and overview, and plays it in the preview', async () => {
    vi.mocked(listMovies).mockResolvedValue({ items: [bunny], nextPageToken: null })
    vi.mocked(getObject).mockImplementation(async (id: string) =>
      id === 'fanart-1'
        ? ({ id, name: 'bbb-fanart.jpg', downloadUrl: 'https://images.example.com/fanart.jpg' } as never)
        : ({
            id,
            name: 'bbb.mkv',
            type: 'video/x-matroska',
            size: 10,
            downloadUrl: 'https://video.example.com/bbb',
          } as never),
    )
    const view = renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /Big Buck Bunny/ }))
    expect(search.movie).toBe('video-1')
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MoviesPage />
      </QueryClientProvider>,
    )

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Big Buck Bunny')).toBeTruthy()
    expect(within(sheet).getByText(/2008 · movies.runtime:\{"minutes":10\}/)).toBeTruthy()
    expect(within(sheet).getByText('Animation')).toBeTruthy()
    expect(within(sheet).getByText('A giant rabbit.')).toBeTruthy()
    await vi.waitFor(() =>
      expect(sheet.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/fanart.jpg'),
    )

    fireEvent.click(within(sheet).getByRole('button', { name: /movies.play/ }))
    const preview = await screen.findByRole('dialog', { name: 'preview' })
    expect(preview.textContent).toBe('bbb.mkv https://video.example.com/bbb')
  })

  it('says what would be here when there are no movies', async () => {
    vi.mocked(listMovies).mockResolvedValueOnce({ items: [], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('movies.emptyTitle')).toBeTruthy()
    expect(screen.getByText('movies.emptyHint')).toBeTruthy()
  })

  it('shows an inline alert with retry when the list fails to load', async () => {
    vi.mocked(listMovies)
      .mockRejectedValueOnce(
        new ApiError(503, { error: { code: 503, message: 'Movies are unavailable', status: 'UNAVAILABLE' } }),
      )
      .mockResolvedValueOnce({ items: [sintel], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('Movies are unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(await screen.findByRole('button', { name: /Sintel/ })).toBeTruthy()
  })
})

describe('Movies page [spec: media-catalog/movie-link]', () => {
  it('opens a linked movie that is not on the loaded page', async () => {
    search.movie = 'video-2'
    vi.mocked(listMovies).mockResolvedValue({ items: [bunny], nextPageToken: 'page-2' })
    vi.mocked(getMovie).mockResolvedValue(sintel)
    renderPage()

    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('Sintel')).toBeTruthy()
    expect(within(sheet).getByText('Movies/Sintel (2010)/sintel.mkv')).toBeTruthy()
    expect(getMovie).toHaveBeenCalledWith('video-2')
  })

  it('uses the loaded row without fetching when the linked movie is on the page', async () => {
    search.movie = 'video-1'
    vi.mocked(listMovies).mockResolvedValue({ items: [bunny], nextPageToken: null })
    renderPage()

    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('A giant rabbit.')).toBeTruthy()
    expect(getMovie).not.toHaveBeenCalled()
  })

  it('says the movie was not found for a link to an unknown movie', async () => {
    search.movie = 'missing'
    vi.mocked(listMovies).mockResolvedValue({ items: [bunny], nextPageToken: null })
    vi.mocked(getMovie).mockRejectedValue(
      new ApiError(404, { error: { code: 404, message: 'Movie not found', status: 'NOT_FOUND' } }),
    )
    renderPage()

    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('movies.notFoundTitle')).toBeTruthy()
    expect(within(sheet).getByText('movies.notFoundHint')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'common.close' }))
    expect(search.movie).toBeUndefined()
  })
})

describe('Movies page [spec: media-catalog/search]', () => {
  it('searches on the server with the text kept in the URL, and says when nothing matches', async () => {
    vi.mocked(listMovies).mockImplementation(async (opts) =>
      opts?.search ? { items: [], nextPageToken: null } : { items: [bunny, sintel], nextPageToken: null },
    )
    const view = renderPage()
    await screen.findByRole('button', { name: /Sintel/ })

    fireEvent.change(screen.getByRole('textbox', { name: 'movies.search' }), { target: { value: 'nothing' } })
    expect(search.q).toBe('nothing')
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }))
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MoviesPage />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('movies.noMatchTitle')).toBeTruthy()
    expect(screen.getByText('movies.noMatchHint')).toBeTruthy()
    expect(listMovies).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 24, search: 'nothing' })
  })

  it('starts from the search in the URL', async () => {
    search.q = 'sin'
    vi.mocked(listMovies).mockResolvedValue({ items: [sintel], nextPageToken: null })
    renderPage()

    expect(await screen.findByRole('button', { name: /Sintel/ })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'movies.search' }) as HTMLInputElement).value).toBe('sin')
    expect(listMovies).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 24, search: 'sin' })
  })
})
