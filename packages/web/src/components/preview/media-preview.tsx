import { MediaCommunitySkin, MediaOutlet, MediaPlayer } from '@vidstack/react'
import 'vidstack/styles/defaults.css'
import 'vidstack/styles/community-skin/video.css'
import 'vidstack/styles/community-skin/audio.css'
import type { PreviewType } from '@/lib/file-types'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

export function MediaPreview({ url, filename, previewType }: MediaPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <MediaPlayer title={filename} src={url} viewType={previewType === 'video' ? 'video' : 'audio'} className="w-full">
        <MediaOutlet />
        <MediaCommunitySkin />
      </MediaPlayer>
    </div>
  )
}
