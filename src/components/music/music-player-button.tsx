import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { DefaultAudioLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import { Music } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { mimeFromExt } from '@/components/preview/media-preview'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getObject } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toPreviewFile } from './music-player-model'
import { type MusicTrack, useMusicPlayer } from './music-player-provider'

function TrackCover({ track, large }: { track: MusicTrack; large?: boolean }) {
  const size = large ? 'size-14' : 'size-8'

  if (track.coverUrl) {
    return <img src={track.coverUrl} alt="" className={cn(size, 'shrink-0 rounded-md object-cover')} />
  }

  return (
    <div
      className={cn(
        size,
        'flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground',
        large && 'bg-primary/10 text-primary',
      )}
    >
      <Music className={large ? 'size-6' : 'size-4'} />
    </div>
  )
}

function TrackButton({
  track,
  active,
  selected,
  onSelect,
  onPlay,
}: {
  track: MusicTrack
  active: boolean
  selected: boolean
  onSelect: (track: MusicTrack) => void
  onPlay: (track: MusicTrack) => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'relative flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 pl-3 text-left text-sm outline-none transition-colors hover:bg-accent/70 focus-visible:bg-accent',
        active && 'bg-primary/10 text-foreground',
        selected && !active && 'bg-accent text-accent-foreground',
      )}
      onClick={() => onSelect(track)}
      onDoubleClick={() => onPlay(track)}
    >
      {active && <span className="absolute top-1.5 bottom-1.5 left-1 w-0.5 rounded-full bg-primary" />}
      <TrackCover track={track} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{track.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[track.artist, track.album, formatSize(track.size)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  )
}

export function MusicPlayerButton() {
  const { t } = useTranslation()
  const menuContainerId = useId()
  const player = useMusicPlayer()
  const tracks = player.playlist

  async function handlePlay(track: MusicTrack) {
    try {
      const item = await getObject(track.id)
      player.play({ ...track, ...toPreviewFile(item) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('music.playFailed'))
    }
  }

  const currentTrack = player.currentTrack
  const selectedTrack = player.selectedTrack

  return (
    <Popover open={player.open} onOpenChange={player.setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label={t('music.player')}>
          <Music className="h-4 w-4" />
          {currentTrack && <span className="absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent forceMount align="end" className="w-80 overflow-hidden p-0 data-[state=closed]:hidden">
        <div className="border-b px-3 py-2">
          <p className="text-sm font-semibold">{t('music.player')}</p>
        </div>
        <div className="bg-muted/30 px-3 py-3">
          {currentTrack ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center gap-3">
                <TrackCover track={currentTrack} large />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{currentTrack.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {currentTrack.artist ?? t('music.unknownArtist')}
                  </p>
                  {currentTrack.album && <p className="truncate text-xs text-muted-foreground">{currentTrack.album}</p>}
                </div>
              </div>
              <MediaPlayer
                title={currentTrack.name}
                artist={currentTrack.artist}
                artwork={currentTrack.coverUrl ? [{ src: currentTrack.coverUrl }] : null}
                src={{ src: currentTrack.downloadUrl, type: mimeFromExt(currentTrack.name, 'audio') as 'audio/mpeg' }}
                viewType="audio"
                autoPlay
                crossOrigin
                className="w-full [--audio-bg:transparent] [--audio-border:0] [--audio-border-radius:0] [--audio-filter:none]"
              >
                <MediaProvider />
                <DefaultAudioLayout icons={defaultLayoutIcons} menuContainer={`#${menuContainerId}`} noModal />
              </MediaPlayer>
              <div id={menuContainerId} />
            </div>
          ) : (
            <div className="rounded-md border border-dashed bg-background px-3 py-5 text-center text-sm text-muted-foreground">
              {t('music.emptyHint')}
            </div>
          )}
        </div>
        <div className="border-t">
          <div className="flex items-center justify-between px-3 py-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('music.queue')}</p>
            <p className="text-xs tabular-nums text-muted-foreground">{tracks.length}</p>
          </div>
          <div className="max-h-52 overflow-y-auto px-1 pb-1">
            {tracks.length > 0 ? (
              tracks.map((track) => (
                <TrackButton
                  key={track.id}
                  track={track}
                  active={track.id === currentTrack?.id}
                  selected={track.id === selectedTrack?.id}
                  onSelect={player.select}
                  onPlay={handlePlay}
                />
              ))
            ) : (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">{t('music.queueEmpty')}</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
