import { Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { getPreviewType, type PreviewType } from '@/lib/file-types'
import { formatSize } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ExternalPlayerMenu } from './external-player-menu'
import { FilePreviewContent, PreviewDownloadButton, type PreviewFile } from './file-preview-content'
import { ImagePreview } from './image-preview'

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

function dialogClass(previewType: PreviewType, fullscreen: boolean): string {
  if (fullscreen) {
    return 'h-[100dvh] w-[100dvw] max-w-none rounded-none border-0 sm:max-w-none'
  }

  // DialogContent caps width with sm:max-w-lg; each override must use the same breakpoint to take effect.
  switch (previewType) {
    case 'video':
      // Width also follows the viewport height so a 16:9 frame stays fully visible.
      return 'h-auto w-[min(92vw,1280px,calc((90dvh_-_4rem)*16/9))] max-w-none sm:max-w-none'
    case 'audio':
      return 'sm:max-w-md h-auto'
    case 'pdf':
      return 'sm:max-w-4xl h-[85vh]'
    case 'markdown':
    case 'code':
    case 'text':
    case 'nfo':
      return 'sm:max-w-5xl h-[85vh]'
    default:
      return 'sm:max-w-3xl h-[75vh]'
  }
}

function PreviewHeader({
  file,
  previewType,
  onClose,
  compact,
  fullscreen,
  onToggleFullscreen,
}: {
  file: PreviewFile
  previewType: PreviewType
  onClose: () => void
  compact?: boolean
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}) {
  const { t } = useTranslation()
  const fullscreenLabel = fullscreen ? t('preview.exitFullscreen') : t('preview.fullscreen')
  const closeLabel = t('preview.close')

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium', compact ? 'text-sm' : 'text-base')}>{file.name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-2">
        {previewType === 'video' && <ExternalPlayerMenu url={file.downloadUrl} iconOnly compact={compact} />}
        <PreviewDownloadButton url={file.downloadUrl} filename={file.name} compact={compact} />
        {onToggleFullscreen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size={compact ? 'icon-xs' : 'icon-sm'}
                onClick={onToggleFullscreen}
                aria-label={fullscreenLabel}
                title={fullscreenLabel}
              >
                {fullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
                <span className="sr-only">{fullscreenLabel}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{fullscreenLabel}</TooltipContent>
          </Tooltip>
        )}
        <Button
          variant="ghost"
          size={compact ? 'icon-xs' : 'icon-sm'}
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
        >
          <XIcon className="size-4" />
          <span className="sr-only">{closeLabel}</span>
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
        <PreviewHeader file={file} previewType={previewType} onClose={() => onOpenChange(false)} compact />
        <div
          className={cn(
            'flex-1',
            previewType === 'video' || previewType === 'audio' ? 'overflow-hidden' : 'overflow-auto',
          )}
        >
          <FilePreviewContent file={file} previewType={previewType} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DesktopPreview({ file, previewType, open, onOpenChange }: PreviewPanelProps) {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!open) setFullscreen(false)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn('flex flex-col gap-0 overflow-hidden p-0', dialogClass(previewType, fullscreen))}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{file.name}</DialogTitle>
        </DialogHeader>
        <PreviewHeader
          file={file}
          previewType={previewType}
          onClose={() => onOpenChange(false)}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
        />
        <div
          className={cn(
            'flex-1',
            previewType === 'video' || previewType === 'audio' ? 'overflow-hidden' : 'overflow-auto',
          )}
        >
          <FilePreviewContent file={file} previewType={previewType} />
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
