import { useQuery } from '@tanstack/react-query'
import { Clapperboard, Play, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ApiError, getMovie, getObject, type Movie } from '@/lib/api'
import { useVideoPreview } from './use-video-preview'

interface MovieSheetProps {
  // The movie the URL selects.
  id: string | null
  // That movie when it is among the rows already loaded; otherwise the sheet
  // fetches it, so a shared link opens wherever the movie sits in the list.
  movie: Movie | null
  // The list is still loading, so whether it holds the movie is not known yet.
  listLoading: boolean
  onOpenChange: (open: boolean) => void
}

export function MovieSheet({ id, movie, listLoading, onOpenChange }: MovieSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={id !== null} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {id !== null && (movie ? <MovieDetails movie={movie} /> : <FetchedMovie id={id} enabled={!listLoading} />)}
        {/* The close button sits over the fanart, so it carries its own surface
            to stay legible on any image. */}
        <SheetClose className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden">
          <XIcon className="size-4" />
          <span className="sr-only">{t('common.close')}</span>
        </SheetClose>
      </SheetContent>
    </Sheet>
  )
}

function FetchedMovie({ id, enabled }: { id: string; enabled: boolean }) {
  const { t } = useTranslation()
  const query = useQuery({ queryKey: ['media', 'movies', 'detail', id], queryFn: () => getMovie(id), enabled })
  if (query.data) return <MovieDetails movie={query.data} />
  if (query.isPending) {
    return (
      <SheetHeader className="px-6 pt-5">
        <SheetTitle className="sr-only">{t('movies.title')}</SheetTitle>
        <SheetDescription className="py-10 text-center" role="status">
          {t('common.loading')}
        </SheetDescription>
      </SheetHeader>
    )
  }
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <SheetHeader className="items-center gap-2 px-6 py-20 text-center">
        <Clapperboard className="size-12 text-muted-foreground" aria-hidden="true" />
        <SheetTitle>{t('movies.notFoundTitle')}</SheetTitle>
        <SheetDescription className="max-w-sm">{t('movies.notFoundHint')}</SheetDescription>
      </SheetHeader>
    )
  }
  return (
    <div className="px-6 pt-5 pb-6">
      <SheetHeader className="p-0 pb-4">
        <SheetTitle>{t('movies.title')}</SheetTitle>
      </SheetHeader>
      <LoadErrorAlert error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
    </div>
  )
}

function MovieDetails({ movie }: { movie: Movie }) {
  const { t } = useTranslation()
  const { media } = movie
  const video = useVideoPreview()
  // Fanart is fetched when the sheet opens, through the ordinary object
  // download path, so a list page does not meter every backdrop.
  const fanart = useQuery({
    queryKey: ['objects', media.fanart, 'download'],
    queryFn: () => getObject(media.fanart as string),
    enabled: media.fanart !== undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  const fanartUrl = fanart.data?.downloadUrl ?? movie.posterUrl
  const [failedUrl, setFailedUrl] = useState<string>()

  const facts = [
    media.year !== undefined ? String(media.year) : null,
    media.runtime !== undefined ? t('movies.runtime', { minutes: media.runtime }) : null,
  ].filter((fact): fact is string => fact !== null)

  return (
    <>
      <div className="aspect-video w-full bg-muted">
        {fanartUrl && fanartUrl !== failedUrl && (
          <img src={fanartUrl} alt="" onError={() => setFailedUrl(fanartUrl)} className="h-full w-full object-cover" />
        )}
      </div>
      <SheetHeader className="gap-1.5 px-6 pt-5 pb-2">
        <SheetTitle className="text-xl">{media.title}</SheetTitle>
        <SheetDescription>
          {facts.join(' · ')}
          {media.originalTitle && media.originalTitle !== media.title && (
            <span className="block">{media.originalTitle}</span>
          )}
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 px-6 pb-6">
        {media.genres && media.genres.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t('movies.genres')}>
            {media.genres.map((genre) => (
              <li key={genre}>
                <Badge variant="secondary">{genre}</Badge>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button onClick={() => video.play(movie.id)} disabled={video.opening !== null}>
            <Play />
            {video.opening ? t('common.loading') : t('movies.play')}
          </Button>
        </div>
        {media.overview && <p className="text-sm leading-relaxed">{media.overview}</p>}
        <p className="break-all text-xs text-muted-foreground">{movie.path}</p>
      </div>
      {video.dialog}
    </>
  )
}
