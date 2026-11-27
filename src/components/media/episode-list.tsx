import { ImageOff, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Episode } from '@/lib/api'

interface EpisodeListProps {
  episodes: Episode[]
  opening: string | null
  onPlay: (episode: Episode) => void
}

// A show's episodes, in the server's season and episode order, grouped under
// one heading per season; specials (season 0) first.
export function EpisodeList({ episodes, opening, onPlay }: EpisodeListProps) {
  const { t } = useTranslation()
  const seasons: { season: number; episodes: Episode[] }[] = []
  for (const episode of episodes) {
    const last = seasons.at(-1)
    if (last && last.season === episode.media.season) last.episodes.push(episode)
    else seasons.push({ season: episode.media.season, episodes: [episode] })
  }
  return (
    <div className="flex flex-col gap-8">
      {seasons.map(({ season, episodes }) => {
        const heading = season === 0 ? t('shows.specials') : t('shows.season', { number: season })
        return (
          <section key={season} aria-label={heading} className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">{heading}</h2>
            <ul className="flex flex-col gap-2">
              {episodes.map((episode) => (
                <li key={episode.id}>
                  <EpisodeRow episode={episode} opening={opening === episode.id} onPlay={() => onPlay(episode)} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}

function EpisodeRow({ episode, opening, onPlay }: { episode: Episode; opening: boolean; onPlay: () => void }) {
  const { t } = useTranslation()
  const { media } = episode
  const title = media.title ?? t('shows.episodeNumber', { number: media.episode })
  const code = episodeCode(media.season, media.episode)
  return (
    <button
      type="button"
      onClick={onPlay}
      disabled={opening}
      aria-label={t('shows.playEpisode', { code, title })}
      className="group flex w-full gap-3 rounded-lg border p-2 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70 sm:gap-4"
    >
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-muted sm:w-44">
        {episode.stillUrl ? (
          <img src={episode.stillUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" aria-hidden="true" />
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play className="size-6 text-white" aria-hidden="true" />
        </span>
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-xs text-muted-foreground">
          {code}
          {media.aired && ` · ${media.aired}`}
          {opening && ` · ${t('common.loading')}`}
        </p>
        <p className="truncate text-sm font-medium">{title}</p>
        {media.overview && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{media.overview}</p>}
      </div>
    </button>
  )
}
