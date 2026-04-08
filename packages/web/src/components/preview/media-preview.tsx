import type { PreviewType } from '@/lib/file-types'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

export function MediaPreview({ url, filename, previewType }: MediaPreviewProps) {
  if (previewType === 'video') {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded files have no caption tracks */}
        <video src={url} controls controlsList="nodownload" title={filename} className="max-h-full max-w-full" />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded files have no caption tracks */}
      <audio src={url} controls controlsList="nodownload" title={filename} className="w-full max-w-md" />
    </div>
  )
}
