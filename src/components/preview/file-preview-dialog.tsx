import { DownloadIcon, XIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { getPreviewType, type PreviewType } from '@/lib/file-types'
import { cn } from '@/lib/utils'
import { ImagePreview } from './image-preview'

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

interface PreviewPanelProps {
  file: PreviewFile
  previewType: PreviewType
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

function DownloadButton({ url, filename, iconOnly }: { url: string; filename: string; iconOnly?: boolean }) {
  const { t } = useTranslation()
  return (
    <Button variant="outline" size={iconOnly ? 'icon-xs' : 'sm'} asChild>
      <a href={url} download={filename} target="_blank" rel="noopener noreferrer">
        <DownloadIcon className={iconOnly ? 'size-4' : 'mr-2 size-4'} />
        {iconOnly ? <span className="sr-only">{t('preview.download')}</span> : t('preview.download')}
      </a>
    </Button>
  )
}

function dialogClass(previewType: PreviewType): string {
  switch (previewType) {
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

function PreviewHeader({ file, onClose, compact }: { file: PreviewFile; onClose: () => void; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')}>{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-2">
        <DownloadButton url={file.downloadUrl} filename={file.name} iconOnly={compact} />
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function mobileDrawerHeight(previewType: PreviewType): string {
  switch (previewType) {
    case 'audio':
      return 'h-auto max-h-[50dvh]'
    case 'video':
      return 'h-auto max-h-[100dvh]'
    default:
      return 'h-[100dvh]'
  }
}

function MobilePreview({ file, previewType, open, onOpenChange }: PreviewPanelProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn('flex flex-col gap-0 rounded-t-xl p-0', mobileDrawerHeight(previewType))}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{file.name}</SheetTitle>
        </SheetHeader>
        <div className="flex justify-center py-2">
          <div className="h-1 w-8 rounded-full bg-muted-foreground/30" />
        </div>
        <PreviewHeader file={file} onClose={() => onOpenChange(false)} compact />
        <div className="flex-1 overflow-auto">
          <Suspense fallback={<p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>}>
            <PreviewBody file={file} previewType={previewType} />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DesktopPreview({ file, previewType, open, onOpenChange }: PreviewPanelProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={cn('flex flex-col gap-0 p-0', dialogClass(previewType))}>
        <DialogHeader className="sr-only">
          <DialogTitle>{file.name}</DialogTitle>
        </DialogHeader>
        <PreviewHeader file={file} onClose={() => onOpenChange(false)} />
        <div className="flex-1 overflow-auto">
          <Suspense fallback={<p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>}>
            <PreviewBody file={file} previewType={previewType} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function FilePreviewDialog({ file, open, onOpenChange }: FilePreviewDialogProps) {
  const isMobile = useIsMobile()
  const previewType = file ? getPreviewType(file.name, file.type) : 'unsupported'

  if (previewType === 'image' && file) {
    return <ImagePreview url={file.downloadUrl} filename={file.name} open={open} onClose={() => onOpenChange(false)} />
  }

  if (!file) return null

  if (isMobile) {
    return <MobilePreview file={file} previewType={previewType} open={open} onOpenChange={onOpenChange} />
  }

  return <DesktopPreview file={file} previewType={previewType} open={open} onOpenChange={onOpenChange} />
}
