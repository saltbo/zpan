import type { PreviewType } from '@/lib/file-types'

interface MediaPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

export function MediaPreview({ url, filename, previewType }: MediaPreviewProps) {
  if (previewType === 'audio') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded files don't have captions */}
        <audio controls preload="metadata" className="w-full max-w-lg" title={filename}>
          <source src={url} />
        </audio>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-black p-4">
      {/* biome-ignore lint/a11y/useMediaCaption: user-uploaded files don't have captions */}
      <video controls preload="metadata" className="max-h-full max-w-full" title={filename}>
        <source src={url} />
      </video>
    </div>
  )
}
