import { isVideoProvider, MediaPlayer, MediaProvider, type MediaProviderAdapter, type MediaSrc } from '@vidstack/react'
import { DefaultAudioLayout, DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/audio.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { AlertCircleIcon, DownloadIcon, Loader2Icon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PreviewType } from '@/lib/file-types'
import type { MseStream } from '@/lib/media-pipeline/mse-stream'
import type { UnsupportedReason } from '@/lib/media-pipeline/plan'
import type { SidecarSubtitle } from '@/lib/subtitles'
import { ExternalPlayerMenu } from './external-player-menu'
import { SubtitleTracks } from './subtitle-tracks'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
  /** Subtitle files found next to a video. */
  subtitles?: readonly SidecarSubtitle[]
}

const NO_SUBTITLES: readonly SidecarSubtitle[] = []

type FailureReason = UnsupportedReason | 'playback'

type VideoSource =
  | { kind: 'probing' }
  | { kind: 'native' }
  | { kind: 'mse'; stream: MseStream }
  | { kind: 'unsupported'; reason: FailureReason }

export function mimeFromExt(filename: string, previewType: PreviewType): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (previewType === 'audio') {
    const map: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      aac: 'audio/aac',
      m4a: 'audio/mp4',
      wma: 'audio/x-ms-wma',
    }
    return map[ext] ?? 'audio/mpeg'
  }
  // Vidstack picks its HTML5 provider from this type, then the browser sniffs the real
  // container. Matroska is a WebM superset, so Chromium plays MKV with common codecs.
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/webm',
  }
  return map[ext] ?? 'video/mp4'
}

export function MediaPreview({ url, filename, previewType, subtitles = NO_SUBTITLES }: MediaPreviewProps) {
  if (previewType === 'audio') return <AudioPreview url={url} filename={filename} />
  return <VideoPreview url={url} filename={filename} subtitles={subtitles} />
}

function AudioPreview({ url, filename }: { url: string; filename: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <PlaybackUnavailable url={url} filename={filename} message="preview.audioUnsupported" />
  return <Player src={url} title={filename} viewType="audio" onFailure={() => setFailed(true)} />
}

function VideoPreview({
  url,
  filename,
  subtitles,
}: {
  url: string
  filename: string
  subtitles: readonly SidecarSubtitle[]
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState<VideoSource>({ kind: 'probing' })

  useEffect(() => {
    let canceled = false
    let releaseStream: (() => void) | null = null
    setSource({ kind: 'probing' })
    import('@/lib/media-pipeline')
      .then(({ preparePlayback }) =>
        preparePlayback(url, (error) => {
          console.error('Media stream failed', error)
          if (!canceled) setSource({ kind: 'unsupported', reason: 'playback' })
        }),
      )
      .then((prepared) => {
        if (canceled || prepared.kind !== 'mse') prepared.dispose()
        if (canceled) return
        if (prepared.kind === 'mse') {
          releaseStream = prepared.dispose
          setSource({ kind: 'mse', stream: prepared.stream })
        } else if (prepared.kind === 'native') {
          setSource({ kind: 'native' })
        } else {
          setSource({ kind: 'unsupported', reason: prepared.reason })
        }
      })
      .catch((error) => {
        // The probe reads the file over CORS range requests; if the storage refuses, the browser may still play it.
        console.warn('Media probe failed, falling back to native playback', error)
        if (!canceled) setSource({ kind: 'native' })
      })
    return () => {
      canceled = true
      releaseStream?.()
    }
  }, [url])

  if (source.kind === 'probing') {
    return (
      <div className="flex aspect-video w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {t('preview.analyzingVideo')}
      </div>
    )
  }

  if (source.kind === 'unsupported') {
    return <PlaybackUnavailable url={url} filename={filename} message={unsupportedMessage(source.reason)} />
  }

  const src: MediaSrc =
    source.kind === 'mse'
      ? { src: source.stream.mediaSource, type: 'video/object' }
      : { src: url, type: mimeFromExt(filename, 'video') as 'video/mp4' }
  return (
    <Player
      src={src}
      title={filename}
      viewType="video"
      onFailure={() => setSource({ kind: 'unsupported', reason: 'playback' })}
      onProviderSetup={(provider) => {
        if (source.kind === 'mse' && isVideoProvider(provider)) source.stream.attach(provider.video)
      }}
    >
      <SubtitleTracks videoUrl={url} videoName={filename} sidecars={subtitles} />
    </Player>
  )
}

function unsupportedMessage(reason: FailureReason): string {
  switch (reason) {
    case 'container':
      return 'preview.videoUnsupportedContainer'
    case 'video-codec':
      return 'preview.videoUnsupportedVideoCodec'
    case 'audio-codec':
      return 'preview.videoUnsupportedAudioCodec'
    case 'playback':
      return 'preview.videoUnsupported'
  }
}

interface PlayerProps {
  src: MediaSrc
  title: string
  viewType: 'video' | 'audio'
  onFailure: () => void
  onProviderSetup?: (provider: MediaProviderAdapter) => void
  children?: ReactNode
}

function Player({ src, title, viewType, onFailure, onProviderSetup, children }: PlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onFailureRef = useRef(onFailure)
  onFailureRef.current = onFailure

  // Vidstack renders the URL as a <source> child. When the browser can't play it, the
  // error fires on <source> only (media.error stays null, the event doesn't bubble), so
  // MediaPlayer's onError never runs. A capture listener on the container catches it.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onSourceError = (event: Event) => {
      if (event.target instanceof HTMLSourceElement) onFailureRef.current()
    }
    container.addEventListener('error', onSourceError, true)
    return () => container.removeEventListener('error', onSourceError, true)
  }, [])

  return (
    <div ref={containerRef} className="flex h-full flex-col items-center justify-center">
      <MediaPlayer
        title={title}
        src={src}
        viewType={viewType}
        crossOrigin
        onError={onFailure}
        onProviderSetup={onProviderSetup}
        className="max-h-full w-full [--audio-bg:transparent] [--audio-border:0] [--audio-border-radius:0] [--audio-filter:none] [--video-bg:transparent] [--video-border:0] [--video-border-radius:0]"
      >
        <MediaProvider />
        {children}
        {viewType === 'audio' ? (
          <DefaultAudioLayout icons={defaultLayoutIcons} />
        ) : (
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        )}
      </MediaPlayer>
    </div>
  )
}

function PlaybackUnavailable({ url, filename, message }: { url: string; filename: string; message: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-destructive/10 p-3 text-destructive">
        <AlertCircleIcon className="size-10" />
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold text-lg">{t('preview.unsupported')}</h3>
        <p className="max-w-sm text-sm text-muted-foreground">{t(message)}</p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <ExternalPlayerMenu url={url} />
        <Button asChild size="sm">
          <a href={url} download={filename} target="_blank" rel="noopener noreferrer">
            <DownloadIcon className="mr-2 size-4" />
            {t('preview.download')}
          </a>
        </Button>
      </div>
    </div>
  )
}
