import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PreviewFile } from '@/components/preview/file-preview-content'
import { FilePreviewDialog } from '@/components/preview/file-preview-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getObject, type Movie } from '@/lib/api'

interface MovieSheetProps {
  movie: Movie | null
  onOpenChange: (open: boolean) => void
}

export function MovieSheet({ movie, onOpenChange }: MovieSheetProps) {
  return (
    <Sheet open={movie !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {movie && <MovieDetails movie={movie} />}
      </SheetContent>
    </Sheet>
  )
}

function MovieDetails({ movie }: { movie: Movie }) {
  const { t } = useTranslation()
  const { media } = movie
  const [preview, setPreview] = useState<PreviewFile | null>(null)
  const [opening, setOpening] = useState(false)
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

  async function play() {
    setOpening(true)
    try {
      const video = await getObject(movie.id)
      if (!video.downloadUrl) throw new Error(t('common.error'))
      setPreview({
        id: video.id,
        name: video.name,
        type: video.type,
        size: video.size ?? 0,
        downloadUrl: video.downloadUrl,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setOpening(false)
    }
  }

  const facts = [
    media.year !== undefined ? String(media.year) : null,
    media.runtime !== undefined ? t('movies.runtime', { minutes: media.runtime }) : null,
  ].filter((fact): fact is string => fact !== null)

  return (
    <>
      <div className="aspect-video w-full bg-muted">
        {fanartUrl && <img src={fanartUrl} alt="" className="h-full w-full object-cover" />}
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
          <Button onClick={play} disabled={opening}>
            <Play />
            {opening ? t('common.loading') : t('movies.play')}
          </Button>
        </div>
        {media.overview && <p className="text-sm leading-relaxed">{media.overview}</p>}
        <p className="break-all text-xs text-muted-foreground">{movie.path}</p>
      </div>
      <FilePreviewDialog
        file={preview}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />
    </>
  )
}
