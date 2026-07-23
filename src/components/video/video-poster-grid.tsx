import type { StorageObject } from '@shared/types'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Download, Film, FolderOpen, Play, Star } from 'lucide-react'
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileActionHandlers } from '@/components/files/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { getObject, listObjectsByPath } from '@/lib/api'
import {
  cacheMovieNfo,
  findVideoCompanions,
  MAX_NFO_BYTES,
  type NfoMovie,
  parseMovieNfo,
  readCachedMovieNfo,
  type VideoCompanions,
} from '@/lib/nfo'

const DIRECTORY_PAGE_SIZE = 500

interface ResolvedVideoCard {
  video: StorageObject
  metadata: NfoMovie | null
  posterUrl: string | null
}

interface VideoPosterGridProps {
  videos: StorageObject[]
  handlers: FileActionHandlers
}

async function loadMovieNfo(nfo: StorageObject): Promise<NfoMovie | null> {
  const cached = readCachedMovieNfo(nfo)
  if (cached) return cached
  if (nfo.size > MAX_NFO_BYTES) return null

  const object = await getObject(nfo.id)
  if (!object.downloadUrl) return null

  const response = await fetch(object.downloadUrl)
  if (!response.ok) throw new Error(`NFO download failed: ${response.status}`)

  const metadata = parseMovieNfo(await response.text())
  if (metadata) cacheMovieNfo(nfo, metadata)
  return metadata
}

async function loadPosterUrl(poster: StorageObject): Promise<string | null> {
  const object = await getObject(poster.id)
  return object.downloadUrl ?? null
}

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const node = ref.current
    if (!node || nearViewport) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setNearViewport(true)
        observer.disconnect()
      },
      { rootMargin: '320px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [nearViewport, ref])

  return nearViewport
}

function VideoPosterCard({
  video,
  companions,
  onSelect,
}: {
  video: StorageObject
  companions: VideoCompanions
  onSelect: (card: ResolvedVideoCard) => void
}) {
  const { t } = useTranslation()
  const cardRef = useRef<HTMLDivElement>(null)
  const nearViewport = useNearViewport(cardRef)
  const assets = useQuery({
    queryKey: [
      'video-poster-card',
      video.id,
      companions.nfo?.id ?? '',
      companions.nfo?.updatedAt ?? '',
      companions.poster?.id ?? '',
      companions.poster?.updatedAt ?? '',
    ],
    queryFn: async () => {
      const [metadata, posterUrl] = await Promise.all([
        companions.nfo ? loadMovieNfo(companions.nfo).catch(() => null) : null,
        companions.poster ? loadPosterUrl(companions.poster).catch(() => null) : null,
      ])
      return { metadata, posterUrl }
    },
    enabled: nearViewport && Boolean(companions.nfo || companions.poster),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  const metadata = assets.data?.metadata ?? null
  const posterUrl = assets.data?.posterUrl ?? null
  const title = metadata?.title ?? video.name
  const facts = [metadata?.year, metadata?.runtime ? t('videos.runtimeMinutes', { count: metadata.runtime }) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card ref={cardRef} className="gap-0 overflow-hidden py-0 shadow-none transition-shadow hover:shadow-md">
      <button
        type="button"
        className="flex h-full min-w-0 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect({ video, metadata, posterUrl })}
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
          {assets.isFetching ? (
            <Skeleton className="size-full rounded-none" />
          ) : posterUrl ? (
            <img src={posterUrl} alt={title} loading="lazy" decoding="async" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <Film className="size-12" aria-hidden="true" />
            </div>
          )}
          {companions.nfo && (
            <Badge variant="secondary" className="absolute top-2 right-2">
              NFO
            </Badge>
          )}
        </div>
        <CardHeader className="w-full gap-1 px-3 py-3">
          <CardTitle className="truncate text-sm" title={title}>
            {title}
          </CardTitle>
          <CardDescription className="min-h-5 truncate">{facts || t('videos.noMetadata')}</CardDescription>
        </CardHeader>
      </button>
    </Card>
  )
}

function VideoDetailsDialog({
  card,
  onClose,
  handlers,
}: {
  card: ResolvedVideoCard | null
  onClose: () => void
  handlers: FileActionHandlers
}) {
  const { t } = useTranslation()
  const metadata = card?.metadata
  const title = metadata?.title ?? card?.video.name ?? ''

  return (
    <Dialog open={Boolean(card)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {[metadata?.originalTitle !== title ? metadata?.originalTitle : null, metadata?.year]
              .filter(Boolean)
              .join(' · ') || t('videos.noMetadata')}
          </DialogDescription>
        </DialogHeader>

        {card && (
          <div className="grid gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="aspect-[2/3] overflow-hidden rounded-lg bg-muted">
              {card.posterUrl ? (
                <img src={card.posterUrl} alt={title} className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-muted-foreground">
                  <Film className="size-12" aria-hidden="true" />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {metadata?.tagline && <p className="text-sm italic text-muted-foreground">{metadata.tagline}</p>}
              {metadata?.plot && <p className="text-sm leading-6">{metadata.plot}</p>}

              {(metadata?.rating || metadata?.runtime || metadata?.premiered) && (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {metadata.rating !== undefined && (
                    <div className="flex flex-col gap-1">
                      <dt className="text-muted-foreground">{t('videos.rating')}</dt>
                      <dd className="flex items-center gap-1 font-medium">
                        <Star className="size-4" aria-hidden="true" />
                        {metadata.rating.toFixed(1)}
                      </dd>
                    </div>
                  )}
                  {metadata.runtime !== undefined && (
                    <div className="flex flex-col gap-1">
                      <dt className="text-muted-foreground">{t('videos.runtime')}</dt>
                      <dd className="font-medium">{t('videos.runtimeMinutes', { count: metadata.runtime })}</dd>
                    </div>
                  )}
                  {metadata.premiered && (
                    <div className="flex flex-col gap-1">
                      <dt className="text-muted-foreground">{t('videos.premiered')}</dt>
                      <dd className="font-medium">{metadata.premiered}</dd>
                    </div>
                  )}
                </dl>
              )}

              {metadata && metadata.genres.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {metadata.genres.map((genre) => (
                    <Badge key={genre} variant="outline">
                      {genre}
                    </Badge>
                  ))}
                </div>
              )}

              {metadata && metadata.directors.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{t('videos.director')}</span>
                  <span>{metadata.directors.join(', ')}</span>
                </div>
              )}

              {metadata && metadata.actors.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{t('videos.actors')}</span>
                  <span>{metadata.actors.slice(0, 8).join(', ')}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FolderOpen className="size-4" aria-hidden="true" />
                <span className="truncate">{card.video.parent || '/'}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {card && handlers.onDownload && (
            <Button variant="outline" onClick={() => handlers.onDownload?.(card.video)}>
              <Download data-icon="inline-start" />
              {t('files.download')}
            </Button>
          )}
          {card && (
            <Button
              onClick={() => {
                onClose()
                handlers.onOpen(card.video)
              }}
            >
              <Play data-icon="inline-start" />
              {t('videos.play')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function VideoPosterGrid({ videos, handlers }: VideoPosterGridProps) {
  const [selectedCard, setSelectedCard] = useState<ResolvedVideoCard | null>(null)
  const parents = useMemo(() => [...new Set(videos.map((video) => video.parent))], [videos])
  const directoryQueries = useQueries({
    queries: parents.map((parent) => ({
      queryKey: ['objects', 'active', 'path', parent, '', ''],
      queryFn: () => listObjectsByPath(parent, 1, DIRECTORY_PAGE_SIZE),
      staleTime: 60 * 1000,
    })),
  })

  const directories = new Map<string, StorageObject[]>()
  parents.forEach((parent, index) => {
    directories.set(parent, directoryQueries[index]?.data?.items ?? [])
  })

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4 p-4 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {videos.map((video) => (
          <VideoPosterCard
            key={video.id}
            video={video}
            companions={findVideoCompanions(video, directories.get(video.parent) ?? [])}
            onSelect={setSelectedCard}
          />
        ))}
      </div>
      <VideoDetailsDialog card={selectedCard} onClose={() => setSelectedCard(null)} handlers={handlers} />
    </>
  )
}
