import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PreviewType } from '@/lib/file-types'
import { getShikiLanguage } from '@/lib/file-types'

interface TextPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

export function TextPreview({ url, filename, previewType }: TextPreviewProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch')
        return res.text()
      })
      .then(setContent)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(true)
      })
    return () => controller.abort()
  }, [url])

  if (error) return <p className="p-4 text-center text-destructive">{t('preview.loadError')}</p>
  if (content === null) return <p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>

  if (previewType === 'markdown') return <MarkdownRenderer content={content} />
  if (previewType === 'code') return <CodeRenderer content={content} filename={filename} />
  return <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">{content}</pre>
}

function MarkdownRenderer({ content }: { content: string }) {
  const [error, setError] = useState(false)
  const { t } = useTranslation()
  const [modules, setModules] = useState<{
    Markdown: FC<{ remarkPlugins: unknown[]; children: string }>
    remarkGfm: unknown
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([import('react-markdown'), import('remark-gfm')])
      .then(([md, gfm]) => {
        if (cancelled) return
        setModules({
          Markdown: md.default as FC<{ remarkPlugins: unknown[]; children: string }>,
          remarkGfm: gfm.default,
        })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="p-4 text-center text-destructive">{t('preview.loadError')}</p>
  if (!modules) return <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">{content}</pre>

  const { Markdown, remarkGfm } = modules
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none p-4">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}

function CodeRenderer({ content, filename }: { content: string; filename: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    let cancelled = false
    import('shiki')
      .then(({ codeToHtml }) => {
        const lang = getShikiLanguage(filename)
        // Shiki HTML-escapes all code content before wrapping in <span> tokens.
        return codeToHtml(content, { lang, theme: 'github-dark' })
      })
      .then((result) => {
        if (!cancelled) setHtml(result)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [content, filename])

  if (error) return <p className="p-4 text-center text-destructive">{t('preview.loadError')}</p>
  if (!html) return <pre className="whitespace-pre-wrap break-words p-4 font-mono text-sm">{content}</pre>

  // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki HTML-escapes all code content before wrapping in tokens
  return <div className="overflow-auto text-sm [&_pre]:p-4" dangerouslySetInnerHTML={{ __html: html }} />
}
