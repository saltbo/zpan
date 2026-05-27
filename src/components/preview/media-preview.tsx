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
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
  }
  return map[ext] ?? 'video/mp4'
}

export function MediaPreview({ url, filename, previewType }: MediaPreviewProps) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const isUnsupported = previewType === 'video' && ['mkv', 'avi', 'wmv', 'flv'].includes(ext)
  const [error, setError] = useState(isUnsupported)
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
            {previewType === 'video'
              ? '当前浏览器不支持播放该格式或编码的视频。建议您将视频下载到本地，使用系统播放器进行播放。'
              : '当前浏览器不支持播放该格式或编码的音频。建议您将音频下载到本地进行播放。'}
          </p>
        </div>
        <Button asChild className="mt-2">
          <a href={url} download={filename} target="_blank" rel="noopener noreferrer">
            <DownloadIcon className="mr-2 size-4" />
            {t('preview.download')}
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <MediaPlayer
        title={filename}
        src={url}
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
    </div>
  )
}
