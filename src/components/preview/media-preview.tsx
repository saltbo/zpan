import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { DefaultAudioLayout, DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/audio.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import { AlertCircleIcon, DownloadIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PreviewType } from '@/lib/file-types'
import { ExternalPlayerMenu } from './external-player-menu'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

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
  // Unknown formats still get a chance and fall back via onError.
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/webm',
  }
  return map[ext] ?? 'video/mp4'
}

export function MediaPreview({ url, filename, previewType }: MediaPreviewProps) {
  const [error, setError] = useState(false)
  const { t } = useTranslation()

  if (error) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="rounded-full bg-destructive/10 p-3 text-destructive">
          <AlertCircleIcon className="size-10" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-lg">{t('preview.unsupported')}</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            {previewType === 'video' ? t('preview.videoUnsupported') : t('preview.audioUnsupported')}
          </p>
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

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <MediaPlayer
        title={filename}
        src={previewType === 'video' ? { src: url, type: mimeFromExt(filename, previewType) as 'video/mp4' } : url}
        viewType={previewType === 'video' ? 'video' : 'audio'}
        crossOrigin
        onError={() => setError(true)}
        className="max-h-full w-full [--audio-bg:transparent] [--audio-border:0] [--audio-border-radius:0] [--audio-filter:none] [--video-bg:transparent] [--video-border:0] [--video-border-radius:0]"
      >
        <MediaProvider />
        {previewType === 'audio' ? (
          <DefaultAudioLayout icons={defaultLayoutIcons} />
        ) : (
          <DefaultVideoLayout icons={defaultLayoutIcons} />
        )}
      </MediaPlayer>
      {previewType === 'video' && (
        <div className="flex w-full justify-end px-2 py-2">
          <ExternalPlayerMenu url={url} variant="ghost" />
        </div>
      )}
    </div>
  )
}
