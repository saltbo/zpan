import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Clapperboard, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { PageHeader } from '@/components/layout/page-header'
import { MovieGrid } from '@/components/media/movie-grid'
import { MovieSheet } from '@/components/media/movie-sheet'
import { Input } from '@/components/ui/input'
import { useUrlText } from '@/hooks/use-url-text'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { listMovies } from '@/lib/api'

export const moviesSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  movie: z.string().min(1).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/movies/')({
  validateSearch: moviesSearchSchema,
  component: MoviesPage,
})

const QUERY_KEY = ['media', 'movies']
const PAGE_SIZE = 24

export function MoviesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/movies/' })
  const search = useSearch({ from: '/_authenticated/movies/' })
  const selectedId = search.movie ?? null
  const [text, setText] = useUrlText(search.q ?? '', (value) =>
    navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  )

  useServerEventSubscription('movies-page', ['matter'], () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  })

  const moviesQuery = useInfiniteQuery({
    queryKey: [...QUERY_KEY, PAGE_SIZE, search.q ?? ''],
    queryFn: ({ pageParam }) => listMovies({ pageToken: pageParam, pageSize: PAGE_SIZE, search: search.q }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    placeholderData: keepPreviousData,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: moviesQuery.hasNextPage,
    isFetchingNextPage: moviesQuery.isFetchingNextPage,
    fetchNextPage: moviesQuery.fetchNextPage,
  })
  const movies = moviesQuery.data?.pages.flatMap((page) => page.items) ?? []
  const selected = movies.find((movie) => movie.id === selectedId) ?? null

  function select(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, movie: id }) })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        items={[{ label: t('movies.title'), icon: <Clapperboard className="size-4 text-muted-foreground" /> }]}
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('movies.searchPlaceholder')}
          aria-label={t('movies.search')}
          className="h-9 pl-8"
        />
      </div>

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
          <p className="text-sm font-medium text-foreground">
            {search.q ? t('movies.noMatchTitle') : t('movies.emptyTitle')}
          </p>
          <p className="max-w-sm text-sm">{search.q ? t('movies.noMatchHint') : t('movies.emptyHint')}</p>
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
        id={selectedId}
        movie={selected}
        listLoading={moviesQuery.isPending}
        onOpenChange={(open) => {
          if (!open) select(undefined)
        }}
      />
    </div>
  )
}
