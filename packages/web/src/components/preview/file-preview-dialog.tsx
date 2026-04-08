import { Download, FileIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getPreviewType, type PreviewType } from '@/lib/file-types'

const ImagePreview = lazy(() => import('./image-preview').then((m) => ({ default: m.ImagePreview })))
const PdfPreview = lazy(() => import('./pdf-preview').then((m) => ({ default: m.PdfPreview })))
const TextPreview = lazy(() => import('./text-preview').then((m) => ({ default: m.TextPreview })))
const MediaPreview = lazy(() => import('./media-preview').then((m) => ({ default: m.MediaPreview })))

export interface PreviewFile {
  name: string
  size: number
  url: string
  mimeType?: string
}

interface FilePreviewDialogProps {
  file: PreviewFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Other images in the folder for gallery navigation */
  siblingImages?: Array<{ url: string; filename: string }>
}

export function FilePreviewDialog({ file, open, onOpenChange, siblingImages }: FilePreviewDialogProps) {
  const { t } = useTranslation()

  if (!file) return null

  const previewType = getPreviewType(file.name, file.mimeType)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 p-0" showCloseButton>
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
            <DialogTitle className="truncate text-sm font-medium">{file.name}</DialogTitle>
            <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
          </div>
          <Button variant="ghost" size="sm" asChild className="shrink-0">
            <a href={file.url} download={file.name}>
              <Download className="mr-1 size-4" />
              {t('preview.download')}
            </a>
          </Button>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<LoadingFallback />}>
            <PreviewContent file={file} previewType={previewType} siblingImages={siblingImages} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewContent({
  file,
  previewType,
  siblingImages,
}: {
  file: PreviewFile
  previewType: PreviewType
  siblingImages?: Array<{ url: string; filename: string }>
}) {
  const { t } = useTranslation()

  switch (previewType) {
    case 'image':
      return <ImagePreview url={file.url} filename={file.name} siblingUrls={siblingImages} />
    case 'pdf':
      return <PdfPreview url={file.url} />
    case 'markdown':
    case 'code':
    case 'text':
      return <TextPreview url={file.url} filename={file.name} previewType={previewType} />
    case 'audio':
    case 'video':
      return <MediaPreview url={file.url} filename={file.name} previewType={previewType} />
    default:
      return <UnsupportedPreview filename={file.name} url={file.url} t={t} />
  }
}

function UnsupportedPreview({ filename, url, t }: { filename: string; url: string; t: (key: string) => string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <FileIcon className="size-16 text-muted-foreground" />
      <p className="text-muted-foreground">{t('preview.unsupported')}</p>
      <Button asChild>
        <a href={url} download={filename}>
          <Download className="mr-2 size-4" />
          {t('preview.download')}
        </a>
      </Button>
    </div>
  )
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}
