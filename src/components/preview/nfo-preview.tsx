import { FileTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { NfoDocument, NfoSection } from '@/lib/nfo'
import { parseNfo } from '@/lib/nfo'

interface NfoPreviewProps {
  url: string
}

function Section({ section }: { section: NfoSection }) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardHeader className="border-b px-4 py-3">
        <CardTitle className="font-mono text-sm">{section.name}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <dl className="divide-y">
          {section.fields.map((field) => (
            <div key={field.name} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.35fr)_1fr] sm:gap-4">
              <dt className="break-words font-mono text-muted-foreground text-xs">{field.name}</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-sm">
                {field.values.map((value) => (
                  <div key={value}>{value}</div>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function StructuredNfo({ document }: { document: Exclude<NfoDocument, { format: 'text' }> }) {
  const { t } = useTranslation()
  const label =
    document.format === 'xml' ? t('preview.nfo.xmlFormat', { root: document.root }) : t('preview.nfo.mediaInfoFormat')

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <FileTextIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <Badge variant="secondary">{label}</Badge>
      </div>
      {document.sections.map((section) => (
        <Section key={section.name} section={section} />
      ))}
    </div>
  )
}

export function NfoPreview({ url }: NfoPreviewProps) {
  const { t } = useTranslation()
  const [document, setDocument] = useState<NfoDocument | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setDocument(null)
    setError(false)

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`NFO download failed: ${response.status}`)
        return response.text()
      })
      .then((content) => setDocument(parseNfo(content)))
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(true)
      })

    return () => controller.abort()
  }, [url])

  if (error) return <p className="p-4 text-center text-destructive">{t('preview.loadError')}</p>
  if (!document) return <p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>

  if (document.format === 'text') {
    return (
      <div>
        <div className="border-b p-4">
          <Badge variant="secondary">{t('preview.nfo.textFormat')}</Badge>
        </div>
        <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">{document.content}</pre>
      </div>
    )
  }

  return <StructuredNfo document={document} />
}
