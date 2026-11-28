import { useQuery } from '@tanstack/react-query'
import { Play, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getObject, type Movie } from '@/lib/api'
import { useVideoPreview } from './use-video-preview'

interface MovieSheetProps {
  movie: Movie | null
  onOpenChange: (open: boolean) => void
}

export function MovieSheet({ movie, onOpenChange }: MovieSheetProps) {
  return (
    <Sheet open={movie !== null} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {movie && <MovieDetails movie={movie} />}
      </SheetContent>
    </Sheet>
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
      {/* The close button sits over the fanart, so it carries its own surface
          to stay legible on any image. */}
      <SheetClose className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-hidden">
        <XIcon className="size-4" />
        <span className="sr-only">{t('common.close')}</span>
      </SheetClose>
      {video.dialog}
    </>
  )
}
