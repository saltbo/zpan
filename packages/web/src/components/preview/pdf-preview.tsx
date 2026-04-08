import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import { Button } from '@/components/ui/button'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

interface PdfPreviewProps {
  url: string
}

export function PdfPreview({ url }: PdfPreviewProps) {
  const { t } = useTranslation()
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.2)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm tabular-nums">{t('preview.pageOf', { current: currentPage, total: numPages })}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
          disabled={currentPage >= numPages}
        >
          <ChevronRight className="size-4" />
        </Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>
          <ZoomOut className="size-4" />
        </Button>
        <span className="text-sm tabular-nums">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={() => setScale((s) => Math.min(3, s + 0.2))}>
          <ZoomIn className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<p className="text-center text-muted-foreground">{t('common.loading')}</p>}
          error={<p className="text-center text-destructive">{t('preview.loadError')}</p>}
        >
          <Page pageNumber={currentPage} scale={scale} />
        </Document>
      </div>
    </div>
  )
}
