import { DownloadIcon, XIcon } from 'lucide-react'
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
  id: string
  name: string
  type: string
  size: number
  downloadUrl: string
}

interface FilePreviewDialogProps {
  file: PreviewFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function DownloadButton({ url, filename }: { url: string; filename: string }) {
  const { t } = useTranslation()
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={url} download={filename} target="_blank" rel="noopener noreferrer">
        <DownloadIcon className="mr-2 size-4" />
        {t('preview.download')}
      </a>
    </Button>
  )
}

// Dialog size per preview type
function dialogClass(previewType: PreviewType): string {
  switch (previewType) {
    case 'image':
      return 'max-w-5xl h-[90vh]'
    case 'video':
      return 'max-w-4xl h-auto'
    case 'audio':
      return 'max-w-md h-auto'
    case 'pdf':
      return 'max-w-4xl h-[85vh]'
    default:
      return 'max-w-3xl h-[75vh]'
  }
}

function PreviewBody({ file, previewType }: { file: PreviewFile; previewType: PreviewType }) {
  const { t } = useTranslation()

  switch (previewType) {
    case 'image':
      return <ImagePreview url={file.downloadUrl} filename={file.name} />
    case 'pdf':
      return <PdfPreview url={file.downloadUrl} />
    case 'markdown':
    case 'code':
    case 'text':
      return <TextPreview url={file.downloadUrl} filename={file.name} previewType={previewType} />
    case 'audio':
    case 'video':
      return <MediaPreview url={file.downloadUrl} filename={file.name} previewType={previewType} />
    default:
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-muted-foreground">{t('preview.unsupported')}</p>
          <DownloadButton url={file.downloadUrl} filename={file.name} />
        </div>
      )
  }
}

export function FilePreviewDialog({ file, open, onOpenChange }: FilePreviewDialogProps) {
  const { t } = useTranslation()
  const previewType = file ? getPreviewType(file.name, file.type) : 'unsupported'
  const sizeClass = dialogClass(previewType)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {file && (
        <DialogContent showCloseButton={false} className={`flex flex-col gap-0 p-0 ${sizeClass}`}>
          <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <DialogTitle className="text-base">{file.name}</DialogTitle>
              <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
            </div>
            <div className="flex items-center gap-1">
              <DownloadButton url={file.downloadUrl} filename={file.name} />
              <Button variant="ghost" size="icon-xs" onClick={() => onOpenChange(false)}>
                <XIcon className="size-4" />
                <span className="sr-only">{t('preview.close')}</span>
              </Button>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <Suspense fallback={<p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>}>
              <PreviewBody file={file} previewType={previewType} />
            </Suspense>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
