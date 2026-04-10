interface ImagePreviewProps {
  url: string
  filename: string
}

export function ImagePreview({ url, filename }: ImagePreviewProps) {
  return (
    <div className="flex items-center justify-center overflow-hidden">
      <img src={url} alt={filename} className="max-h-[calc(90vh-4rem)] max-w-[90vw] object-contain" />
    </div>
  )
}
