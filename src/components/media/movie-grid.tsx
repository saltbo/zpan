import type { Movie } from '@/lib/api'
import { PosterGrid } from './poster-grid'

export { PosterPlaceholder } from './poster-grid'

interface MovieGridProps {
  movies: Movie[]
  onOpen: (movie: Movie) => void
}

export function MovieGrid({ movies, onOpen }: MovieGridProps) {
  return <PosterGrid items={movies} onOpen={onOpen} />
}
