import { Film } from 'lucide-react'
import type { Movie } from '@/lib/api'

interface MovieGridProps {
  movies: Movie[]
  onOpen: (movie: Movie) => void
}

export function MovieGrid({ movies, onOpen }: MovieGridProps) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {movies.map((movie) => (
        <li key={movie.id}>
          <MovieCard movie={movie} onOpen={() => onOpen(movie)} />
        </li>
      ))}
    </ul>
  )
}

function MovieCard({ movie, onOpen }: { movie: Movie; onOpen: () => void }) {
  const { title, year } = movie.media
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg border bg-muted transition-shadow group-hover:shadow-md">
        {movie.posterUrl ? (
          <img src={movie.posterUrl} alt={title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <PosterPlaceholder title={title} />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium">{title}</p>
        {year !== undefined && <p className="text-xs text-muted-foreground">{year}</p>}
      </div>
    </button>
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
