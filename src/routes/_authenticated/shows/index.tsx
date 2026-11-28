import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Search, Tv } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { PageHeader } from '@/components/layout/page-header'
import { PosterGrid } from '@/components/media/poster-grid'
import { Input } from '@/components/ui/input'
import { useUrlText } from '@/hooks/use-url-text'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { listShows } from '@/lib/api'

export const showsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/shows/')({
  validateSearch: showsSearchSchema,
  component: ShowsPage,
})

export const SHOWS_QUERY_KEY = ['media', 'shows']
const PAGE_SIZE = 24

export function ShowsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/shows/' })
  const search = useSearch({ from: '/_authenticated/shows/' })
  const [text, setText] = useUrlText(search.q ?? '', (value) =>
    navigate({ search: { q: value || undefined }, replace: true }),
  )

  useServerEventSubscription('shows-page', ['matter'], () => {
    queryClient.invalidateQueries({ queryKey: SHOWS_QUERY_KEY })
  })

  const showsQuery = useInfiniteQuery({
    queryKey: [...SHOWS_QUERY_KEY, PAGE_SIZE, search.q ?? ''],
    queryFn: ({ pageParam }) => listShows({ pageToken: pageParam, pageSize: PAGE_SIZE, search: search.q }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    placeholderData: keepPreviousData,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: showsQuery.hasNextPage,
    isFetchingNextPage: showsQuery.isFetchingNextPage,
    fetchNextPage: showsQuery.fetchNextPage,
  })
  const shows = showsQuery.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="space-y-4">
      <PageHeader items={[{ label: t('shows.title'), icon: <Tv className="size-4 text-muted-foreground" /> }]} />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('shows.searchPlaceholder')}
          aria-label={t('shows.search')}
          className="h-9 pl-8"
        />
      </div>

      {showsQuery.isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <p>{t('common.loading')}</p>
        </div>
      ) : showsQuery.isError && !showsQuery.data ? (
        <LoadErrorAlert
          error={showsQuery.error}
          onRetry={() => showsQuery.refetch()}
          retrying={showsQuery.isFetching}
        />
      ) : shows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
          <Tv className="h-16 w-16" />
          <p className="text-sm font-medium text-foreground">
            {search.q ? t('shows.noMatchTitle') : t('shows.emptyTitle')}
          </p>
          <p className="max-w-sm text-sm">{search.q ? t('shows.noMatchHint') : t('shows.emptyHint')}</p>
        </div>
      ) : (
        <>
          <PosterGrid
            items={shows}
            onOpen={(show) => navigate({ to: '/shows/$showId', params: { showId: show.id } })}
          />
          {showsQuery.isFetchNextPageError ? (
            <LoadErrorAlert
              error={showsQuery.error}
              onRetry={() => showsQuery.fetchNextPage()}
              retrying={showsQuery.isFetchingNextPage}
            />
          ) : (
            showsQuery.hasNextPage && (
              <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground">
                {showsQuery.isFetchingNextPage ? t('common.loading') : ''}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
