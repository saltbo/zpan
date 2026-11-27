import { Film } from 'lucide-react'
import { useState } from 'react'

// A poster card's data: the movie or show title, its year, and the poster URL
// when the poster resolves.
export interface PosterItem {
  id: string
  media: { title: string; year?: number }
  posterUrl?: string
}

interface PosterGridProps<T extends PosterItem> {
  items: T[]
  onOpen: (item: T) => void
}

export function PosterGrid<T extends PosterItem>({ items, onOpen }: PosterGridProps<T>) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <li key={item.id}>
          <PosterCard item={item} onOpen={() => onOpen(item)} />
        </li>
      ))}
    </ul>
  )
}

function PosterCard({ item, onOpen }: { item: PosterItem; onOpen: () => void }) {
  const { title, year } = item.media
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg border bg-muted transition-shadow group-hover:shadow-md">
        <Poster url={item.posterUrl} title={title} loading="lazy" />
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium">{title}</p>
        {year !== undefined && <p className="text-xs text-muted-foreground">{year}</p>}
      </div>
    </button>
  )
}

// The poster image, or the title placeholder when there is no poster or its
// file does not load as an image.
export function Poster({ url, title, loading }: { url?: string; title: string; loading?: 'lazy' }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  if (!url || url === failedUrl) return <PosterPlaceholder title={title} />
  return (
    <img
      src={url}
      alt={title}
      loading={loading}
      onError={() => setFailedUrl(url)}
      className="h-full w-full object-cover"
    />
  )
}

export function PosterPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
      <Film className="size-8" aria-hidden="true" />
      <span className="line-clamp-3 text-sm font-medium text-foreground/80">{title}</span>
    </div>
  )
}
