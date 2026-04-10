interface ImagePreviewProps {
  url: string
  filename: string
}

export function ImagePreview({ url, filename }: ImagePreviewProps) {
  return (
    <div className="flex h-full items-center justify-center bg-muted/30 p-4">
      <img src={url} alt={filename} className="max-h-full max-w-full object-contain" />
    </div>
  )
}
