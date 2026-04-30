import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { DefaultAudioLayout, DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default'
import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/audio.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import type { PreviewType } from '@/lib/file-types'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

function mimeFromExt(filename: string, previewType: PreviewType): string {
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
  const mime = mimeFromExt(filename, previewType)

  return (
    <div className="flex h-full items-center justify-center">
      <MediaPlayer
        title={filename}
        src={{ src: url, type: mime as 'audio/mpeg' }}
        viewType={previewType === 'video' ? 'video' : 'audio'}
        crossOrigin
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
