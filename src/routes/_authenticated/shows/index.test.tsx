import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, listShows, type Show } from '@/lib/api'
import { ShowsPage } from './index'

const navigate = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}))

vi.mock('@/hooks/useServerEvents', () => ({ useServerEventSubscription: vi.fn() }))
vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listShows: vi.fn(),
}))

const breakingBad: Show = {
  id: 'show-1',
  path: 'TV/Breaking Bad (2008)',
  posterUrl: 'https://images.example.com/poster.jpg',
  media: { kind: 'tvshow', tmdb: { id: 1396, type: 'tv' }, title: 'Breaking Bad', year: 2008 },
}
const thrones: Show = {
  id: 'show-2',
  path: 'TV/Game of Thrones (2011)',
  media: { kind: 'tvshow', tmdb: { id: 1399, type: 'tv' }, title: 'Game of Thrones', year: 2011 },
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ShowsPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TV Shows page [spec: media-catalog/broken-poster]', () => {
  it('shows the placeholder when a poster fails to load', async () => {
    vi.mocked(listShows).mockResolvedValueOnce({ items: [breakingBad], nextPageToken: null })
    renderPage()

    fireEvent.error(await screen.findByRole('img', { name: 'Breaking Bad' }))

    const card = screen.getByRole('button', { name: /Breaking Bad/ })
    expect(within(card).queryByRole('img')).toBeNull()
    expect(within(card).getAllByText('Breaking Bad')).toHaveLength(2)
  })
})

describe('TV Shows page [spec: media-catalog/shows]', () => {
  it('shows scraped shows as posters and opens a show', async () => {
    vi.mocked(listShows).mockResolvedValueOnce({ items: [breakingBad, thrones], nextPageToken: null })
    renderPage()

    const poster = await screen.findByRole('img', { name: 'Breaking Bad' })
    expect(poster.getAttribute('src')).toBe('https://images.example.com/poster.jpg')
    const thronesCard = screen.getByRole('button', { name: /Game of Thrones/ })
    expect(within(thronesCard).queryByRole('img')).toBeNull()
    expect(listShows).toHaveBeenCalledWith({ pageToken: undefined, pageSize: 24 })

    fireEvent.click(screen.getByRole('button', { name: /Breaking Bad/ }))
    expect(navigate).toHaveBeenCalledWith({ to: '/shows/$showId', params: { showId: 'show-1' } })
  })

  it('says what would be here when there are no shows', async () => {
    vi.mocked(listShows).mockResolvedValueOnce({ items: [], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('shows.emptyTitle')).toBeTruthy()
    expect(screen.getByText('shows.emptyHint')).toBeTruthy()
  })

  it('shows an inline alert with retry when the list fails to load', async () => {
    vi.mocked(listShows)
      .mockRejectedValueOnce(
        new ApiError(503, { error: { code: 503, message: 'Shows are unavailable', status: 'UNAVAILABLE' } }),
      )
      .mockResolvedValueOnce({ items: [thrones], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('Shows are unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(await screen.findByRole('button', { name: /Game of Thrones/ })).toBeTruthy()
  })
})
