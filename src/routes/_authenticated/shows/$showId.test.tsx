import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Episode, getObject, getShow, listShowEpisodes, type Show } from '@/lib/api'
import { ShowPage } from './$showId'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useParams: () => ({ showId: 'show-1' }),
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
  getShow: vi.fn(),
  listShowEpisodes: vi.fn(),
  getObject: vi.fn(),
}))

const show: Show = {
  id: 'show-1',
  path: 'TV/Breaking Bad (2008)',
  posterUrl: 'https://images.example.com/poster.jpg',
  media: {
    kind: 'tvshow',
    tmdb: { id: 1396, type: 'tv' },
    title: '绝命毒师',
    originalTitle: 'Breaking Bad',
    year: 2008,
    genres: ['剧情'],
    overview: 'A chemistry teacher.',
    fanart: 'fanart-1',
  },
}

function episode(season: number, number: number, extra: Partial<Episode['media']> = {}, stillUrl?: string): Episode {
  return {
    id: `e-${season}-${number}`,
    path: `TV/Breaking Bad (2008)/Season ${season}/e${number}.mkv`,
    media: { kind: 'episode', tmdb: { id: 1396, type: 'tv' }, season, episode: number, ...extra },
    ...(stillUrl ? { stillUrl } : {}),
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ShowPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Show page [spec: media-catalog/shows]', () => {
  it('lists the seasons and their episodes with still, number, title and overview, and plays an episode', async () => {
    vi.mocked(getShow).mockResolvedValue(show)
    vi.mocked(listShowEpisodes).mockResolvedValue({
      items: [
        episode(0, 1, { title: 'Special' }),
        episode(
          1,
          1,
          { title: 'Pilot', overview: 'Walt starts.', aired: '2008-01-20' },
          'https://images.example.com/s1e1.jpg',
        ),
        episode(1, 2),
      ],
      nextPageToken: null,
    })
    vi.mocked(getObject).mockImplementation(async (id: string) =>
      id === 'fanart-1'
        ? ({ id, name: 'fanart.jpg', downloadUrl: 'https://images.example.com/fanart.jpg' } as never)
        : ({
            id,
            name: 'e1.mkv',
            type: 'video/x-matroska',
            size: 10,
            downloadUrl: 'https://video.example.com/e1',
          } as never),
    )
    const { container } = renderPage()

    expect(await screen.findByRole('heading', { name: '绝命毒师' })).toBeTruthy()
    expect(screen.getByText('2008 · Breaking Bad')).toBeTruthy()
    expect(screen.getByText('剧情')).toBeTruthy()
    expect(screen.getByText('A chemistry teacher.')).toBeTruthy()
    await vi.waitFor(() =>
      expect(container.querySelector('img[src="https://images.example.com/fanart.jpg"]')).not.toBeNull(),
    )

    const specials = await screen.findByRole('region', { name: 'shows.specials' })
    expect(within(specials).getByText('Special')).toBeTruthy()
    const season1 = screen.getByRole('region', { name: 'shows.season:{"number":1}' })
    const pilot = within(season1).getByRole('button', { name: /S01E01/ })
    expect(within(pilot).getByText('S01E01 · 2008-01-20')).toBeTruthy()
    expect(within(pilot).getByText('Pilot')).toBeTruthy()
    expect(within(pilot).getByText('Walt starts.')).toBeTruthy()
    expect(pilot.querySelector('img')?.getAttribute('src')).toBe('https://images.example.com/s1e1.jpg')
    // An episode without a title is named by its number.
    expect(within(season1).getByText('shows.episodeNumber:{"number":2}')).toBeTruthy()
    expect(listShowEpisodes).toHaveBeenCalledWith('show-1', { pageToken: undefined, pageSize: 50 })

    fireEvent.click(pilot)
    const preview = await screen.findByRole('dialog', { name: 'preview' })
    expect(preview.textContent).toBe('e1.mkv https://video.example.com/e1')
    expect(getObject).toHaveBeenCalledWith('e-1-1')
  })

  it('says when the show has no episodes left', async () => {
    vi.mocked(getShow).mockResolvedValue({ ...show, posterUrl: undefined })
    vi.mocked(listShowEpisodes).mockResolvedValue({ items: [], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('shows.noEpisodesTitle')).toBeTruthy()
    expect(screen.getAllByText('绝命毒师').length).toBeGreaterThan(1)
  })

  it('shows an inline alert with retry when the show fails to load', async () => {
    vi.mocked(getShow)
      .mockRejectedValueOnce(
        new ApiError(404, { error: { code: 404, message: 'Show not found', status: 'NOT_FOUND' } }),
      )
      .mockResolvedValueOnce(show)
    vi.mocked(listShowEpisodes).mockResolvedValue({ items: [], nextPageToken: null })
    renderPage()

    expect(await screen.findByText('Show not found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }))
    expect(await screen.findByRole('heading', { name: '绝命毒师' })).toBeTruthy()
  })
})
