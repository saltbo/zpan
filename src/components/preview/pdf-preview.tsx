import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface PdfPreviewProps {
  url: string
}

export function PdfPreview({ url }: PdfPreviewProps) {
  const { t } = useTranslation()
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-2 border-b p-2">
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          disabled={pageNumber <= 1}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm tabular-nums">{t('preview.pageOf', { current: pageNumber, total: numPages })}</span>
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
          disabled={pageNumber >= numPages}
        >
          <ChevronRightIcon />
        </Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button variant="outline" size="icon-xs" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}>
          <ZoomOutIcon />
        </Button>
        <span className="text-sm tabular-nums">{Math.round(scale * 100)}%</span>
        <Button variant="outline" size="icon-xs" onClick={() => setScale((s) => Math.min(3, s + 0.25))}>
          <ZoomInIcon />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <Document
          file={url}
          onLoadSuccess={({ numPages: total }) => setNumPages(total)}
          loading={<p className="text-center text-muted-foreground">{t('common.loading')}</p>}
          error={<p className="text-center text-destructive">{t('preview.loadError')}</p>}
        >
          <Page pageNumber={pageNumber} scale={scale} />
        </Document>
      </div>
    </div>
  )
}
