import { type MediaPlayerInstance, TextTrack, useMediaPlayer } from '@vidstack/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { SidecarSubtitle, SubtitleSource, streamEmbeddedCues } from '@/lib/subtitles'

interface SubtitleTracksProps {
  videoUrl: string
  videoName: string
  sidecars: readonly SidecarSubtitle[]
}

/** Adds sidecar and embedded subtitles to the surrounding player's captions menu. */
export function SubtitleTracks({ videoUrl, videoName, sidecars }: SubtitleTracksProps) {
  const player = useMediaPlayer()
  const { i18n } = useTranslation()
  const uiLanguage = i18n.language

  useEffect(() => {
    if (!player) return
    const controller = new AbortController()
    const added: TextTrack[] = []
    // Loaded on demand so the Matroska reader stays out of the main bundle.
    import('@/lib/subtitles').then(async (subtitles) => {
      const sources = await subtitles.loadSubtitleSources({
        videoUrl,
        videoName,
        sidecars,
        uiLanguage,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      for (const source of sources) {
        const track = createTrack(source)
        player.textTracks.add(track)
        added.push(track)
        if (source.kind === 'embedded') {
          streamWhenShown(subtitles.streamEmbeddedCues, player, track, source, controller.signal)
        }
      }
    })
    return () => {
      controller.abort()
      for (const track of added) player.textTracks.remove(track)
    }
  }, [player, videoUrl, videoName, sidecars, uiLanguage])

  return null
}

function createTrack(source: SubtitleSource): TextTrack {
  const init = {
    id: source.id,
    kind: 'subtitles' as const,
    label: source.label,
    language: source.language ?? undefined,
    default: source.isDefault,
  }
  if (source.kind === 'file') return new TextTrack({ ...init, type: source.format, content: source.content })
  // Cues arrive block by block once the track is shown, so it starts empty.
  return new TextTrack({ ...init, type: 'vtt' })
}

function streamWhenShown(
  stream: typeof streamEmbeddedCues,
  player: MediaPlayerInstance,
  track: TextTrack,
  source: Extract<SubtitleSource, { kind: 'embedded' }>,
  signal: AbortSignal,
) {
  const start = () => {
    if (track.mode !== 'showing') return
    track.removeEventListener('mode-change', start)
    stream({
      file: source.file,
      track: source.track,
      currentTime: () => player.currentTime,
      onCue: (cue) => track.addCue(new VTTCue(cue.start, cue.end, cue.text)),
      signal,
    }).catch((error) => {
      if (!signal.aborted) console.error(`Failed to stream subtitle track ${source.label}`, error)
    })
  }
  track.addEventListener('mode-change', start)
  start()
}
