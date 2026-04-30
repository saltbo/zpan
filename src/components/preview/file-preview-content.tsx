import { DownloadIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { PreviewType } from '@/lib/file-types'

export interface PreviewFile {
  id: string
  name: string
  type: string
  size: number
  downloadUrl: string
}

const PdfPreview = lazy(() => import('./pdf-preview').then((m) => ({ default: m.PdfPreview })))
const OfficePreview = lazy(() => import('./office-preview').then((m) => ({ default: m.OfficePreview })))
const TextPreview = lazy(() => import('./text-preview').then((m) => ({ default: m.TextPreview })))
const MediaPreview = lazy(() => import('./media-preview').then((m) => ({ default: m.MediaPreview })))

interface PreviewDownloadButtonProps {
  url: string
  filename: string
  iconOnly?: boolean
}

export function PreviewDownloadButton({ url, filename, iconOnly }: PreviewDownloadButtonProps) {
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

function FilePreviewContentInner({ file, previewType }: { file: PreviewFile; previewType: PreviewType }) {
  const { t } = useTranslation()

  switch (previewType) {
    case 'image':
      return <img src={file.downloadUrl} alt={file.name} className="max-h-full w-full rounded-md object-contain" />
    case 'pdf':
      return <PdfPreview url={file.downloadUrl} />
    case 'office':
      return <OfficePreview url={file.downloadUrl} filename={file.name} />
    case 'markdown':
    case 'code':
    case 'text':
      return <TextPreview url={file.downloadUrl} filename={file.name} previewType={previewType} />
    case 'audio':
    case 'video':
      return <MediaPreview url={file.downloadUrl} filename={file.name} previewType={previewType} />
    default:
      return (
        <div className="flex h-full min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-muted-foreground">{t('preview.unsupported')}</p>
          <PreviewDownloadButton url={file.downloadUrl} filename={file.name} />
        </div>
      )
  }
}

export function FilePreviewContent({ file, previewType }: { file: PreviewFile; previewType: PreviewType }) {
  const { t } = useTranslation()
  return (
    <Suspense fallback={<p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>}>
      <FilePreviewContentInner file={file} previewType={previewType} />
    </Suspense>
  )
}
