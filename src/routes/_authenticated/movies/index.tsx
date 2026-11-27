import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Clapperboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { PageHeader } from '@/components/layout/page-header'
import { MovieGrid } from '@/components/media/movie-grid'
import { MovieSheet } from '@/components/media/movie-sheet'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { listMovies } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/movies/')({
  validateSearch: (search: Record<string, unknown>): { movie?: string } =>
    typeof search.movie === 'string' && search.movie ? { movie: search.movie } : {},
  component: MoviesPage,
})

const QUERY_KEY = ['media', 'movies']
const PAGE_SIZE = 24

export function MoviesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/movies/' })
  const { movie: selectedId } = useSearch({ from: '/_authenticated/movies/' })

  useServerEventSubscription('movies-page', ['matter'], () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  })

  const moviesQuery = useInfiniteQuery({
    queryKey: [...QUERY_KEY, PAGE_SIZE],
    queryFn: ({ pageParam }) => listMovies({ pageToken: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: moviesQuery.hasNextPage,
    isFetchingNextPage: moviesQuery.isFetchingNextPage,
    fetchNextPage: moviesQuery.fetchNextPage,
  })
  const movies = moviesQuery.data?.pages.flatMap((page) => page.items) ?? []
  const selected = movies.find((movie) => movie.id === selectedId) ?? null

  function select(id: string | undefined) {
    navigate({ search: id ? { movie: id } : {} })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        items={[{ label: t('movies.title'), icon: <Clapperboard className="size-4 text-muted-foreground" /> }]}
      />

      {moviesQuery.isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <p>{t('common.loading')}</p>
        </div>
      ) : moviesQuery.isError && !moviesQuery.data ? (
        <LoadErrorAlert
          error={moviesQuery.error}
          onRetry={() => moviesQuery.refetch()}
          retrying={moviesQuery.isFetching}
        />
      ) : movies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
          <Clapperboard className="h-16 w-16" />
          <p className="text-sm font-medium text-foreground">{t('movies.emptyTitle')}</p>
          <p className="max-w-sm text-sm">{t('movies.emptyHint')}</p>
        </div>
      ) : (
        <>
          <MovieGrid movies={movies} onOpen={(movie) => select(movie.id)} />
          {moviesQuery.isFetchNextPageError ? (
            <LoadErrorAlert
              error={moviesQuery.error}
              onRetry={() => moviesQuery.fetchNextPage()}
              retrying={moviesQuery.isFetchingNextPage}
            />
          ) : (
            moviesQuery.hasNextPage && (
              <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground">
                {moviesQuery.isFetchingNextPage ? t('common.loading') : ''}
              </div>
            )
          )}
        </>
      )}

      <MovieSheet
        movie={selected}
        onOpenChange={(open) => {
          if (!open) select(undefined)
        }}
      />
    </div>
  )
}
