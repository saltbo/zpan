import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { Tv } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { PageHeader } from '@/components/layout/page-header'
import { EpisodeList } from '@/components/media/episode-list'
import { PosterPlaceholder } from '@/components/media/poster-grid'
import { useVideoPreview } from '@/components/media/use-video-preview'
import { Badge } from '@/components/ui/badge'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { getObject, getShow, listShowEpisodes, type Show } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/shows/$showId')({
  component: ShowPage,
})

const EPISODE_PAGE_SIZE = 50

export function ShowPage() {
  const { t } = useTranslation()
  const { showId } = useParams({ from: '/_authenticated/shows/$showId' })
  const queryClient = useQueryClient()
  const video = useVideoPreview()

  useServerEventSubscription(`show-page-${showId}`, ['matter'], () => {
    queryClient.invalidateQueries({ queryKey: ['media', 'shows', showId] })
  })

  const showQuery = useQuery({ queryKey: ['media', 'shows', showId], queryFn: () => getShow(showId) })
  const episodesQuery = useInfiniteQuery({
    queryKey: ['media', 'shows', showId, 'episodes', EPISODE_PAGE_SIZE],
    queryFn: ({ pageParam }) => listShowEpisodes(showId, { pageToken: pageParam, pageSize: EPISODE_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: episodesQuery.hasNextPage,
    isFetchingNextPage: episodesQuery.isFetchingNextPage,
    fetchNextPage: episodesQuery.fetchNextPage,
  })
  const episodes = episodesQuery.data?.pages.flatMap((page) => page.items) ?? []
  const show = showQuery.data

  return (
    <div className="space-y-6">
      <PageHeader
        items={[
          { label: t('shows.title'), icon: <Tv className="size-4 text-muted-foreground" />, to: '/shows' },
          ...(show ? [{ label: show.media.title }] : []),
        ]}
      />

      {showQuery.isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <p>{t('common.loading')}</p>
        </div>
      ) : showQuery.isError || !show ? (
        <LoadErrorAlert error={showQuery.error} onRetry={() => showQuery.refetch()} retrying={showQuery.isFetching} />
      ) : (
        <>
          <ShowHero show={show} />
          {episodesQuery.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : episodesQuery.isError && !episodesQuery.data ? (
            <LoadErrorAlert
              error={episodesQuery.error}
              onRetry={() => episodesQuery.refetch()}
              retrying={episodesQuery.isFetching}
            />
          ) : episodes.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-10 text-center text-muted-foreground">
              <p className="text-sm font-medium text-foreground">{t('shows.noEpisodesTitle')}</p>
              <p className="max-w-sm text-sm">{t('shows.noEpisodesHint')}</p>
            </div>
          ) : (
            <>
              <EpisodeList episodes={episodes} opening={video.opening} onPlay={(episode) => video.play(episode.id)} />
              {episodesQuery.isFetchNextPageError ? (
                <LoadErrorAlert
                  error={episodesQuery.error}
                  onRetry={() => episodesQuery.fetchNextPage()}
                  retrying={episodesQuery.isFetchingNextPage}
                />
              ) : (
                episodesQuery.hasNextPage && (
                  <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground">
                    {episodesQuery.isFetchingNextPage ? t('common.loading') : ''}
                  </div>
                )
              )}
            </>
          )}
        </>
      )}
      {video.dialog}
    </div>
  )
}

function ShowHero({ show }: { show: Show }) {
  const { t } = useTranslation()
  const { media } = show
  // Fanart is fetched through the ordinary object download path when the
  // show opens, so the poster list does not meter every backdrop.
  const fanart = useQuery({
    queryKey: ['objects', media.fanart, 'download'],
    queryFn: () => getObject(media.fanart as string),
    enabled: media.fanart !== undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const fanartUrl = fanart.data?.downloadUrl
  return (
    <section className="relative overflow-hidden rounded-xl border bg-muted">
      {fanartUrl && (
        <img
          src={fanartUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30 dark:opacity-25"
        />
      )}
      <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:gap-6 sm:p-6">
        <div className="aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg border bg-background sm:w-40">
          {show.posterUrl ? (
            <img src={show.posterUrl} alt={media.title} className="h-full w-full object-cover" />
          ) : (
            <PosterPlaceholder title={media.title} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">{media.title}</h1>
          <p className="text-sm text-muted-foreground">
            {[media.year, media.originalTitle !== media.title ? media.originalTitle : undefined]
              .filter((fact) => fact !== undefined)
              .join(' · ')}
          </p>
          {media.genres && media.genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('movies.genres')}>
              {media.genres.map((genre) => (
                <li key={genre}>
                  <Badge variant="secondary">{genre}</Badge>
                </li>
              ))}
            </ul>
          )}
          {media.overview && <p className="max-w-3xl text-sm leading-relaxed">{media.overview}</p>}
        </div>
      </div>
    </section>
  )
}
