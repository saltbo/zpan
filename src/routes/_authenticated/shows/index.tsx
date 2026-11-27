import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Tv } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { PageHeader } from '@/components/layout/page-header'
import { PosterGrid } from '@/components/media/poster-grid'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { listShows } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/shows/')({
  component: ShowsPage,
})

export const SHOWS_QUERY_KEY = ['media', 'shows']
const PAGE_SIZE = 24

export function ShowsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useServerEventSubscription('shows-page', ['matter'], () => {
    queryClient.invalidateQueries({ queryKey: SHOWS_QUERY_KEY })
  })

  const showsQuery = useInfiniteQuery({
    queryKey: [...SHOWS_QUERY_KEY, PAGE_SIZE],
    queryFn: ({ pageParam }) => listShows({ pageToken: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
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
          <p className="text-sm font-medium text-foreground">{t('shows.emptyTitle')}</p>
          <p className="max-w-sm text-sm">{t('shows.emptyHint')}</p>
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
