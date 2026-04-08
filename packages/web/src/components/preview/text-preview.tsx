import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Highlighter } from 'shiki'
import type { PreviewType } from '@/lib/file-types'
import { getLanguageFromFilename } from '@/lib/file-types'

/** Module-level singleton to avoid recreating the highlighter per render */
let shikiInstance: Highlighter | null = null
let shikiLoading: Promise<Highlighter> | null = null

function getShikiHighlighter(): Promise<Highlighter> {
  if (shikiInstance) return Promise.resolve(shikiInstance)
  if (shikiLoading) return shikiLoading
  shikiLoading = import('shiki')
    .then(({ createHighlighter }) => createHighlighter({ themes: ['github-dark', 'github-light'], langs: [] }))
    .then((h) => {
      shikiInstance = h
      return h
    })
  return shikiLoading
}

interface TextPreviewProps {
  url: string
  filename: string
  previewType: PreviewType
}

export function TextPreview({ url, filename, previewType }: TextPreviewProps) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const cancelledRef = useRef(false)
  const codeRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && highlighted) node.innerHTML = highlighted
    },
    [highlighted],
  )

  useEffect(() => {
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed')
        return res.text()
      })
      .then(setContent)
      .catch(() => setError(true))
  }, [url])

  useEffect(() => {
    if (content === null || previewType !== 'code') return

    cancelledRef.current = false
    const lang = getLanguageFromFilename(filename)

    getShikiHighlighter()
      .then(async (highlighter) => {
        if (cancelledRef.current) return
        await highlighter.loadLanguage(lang as Parameters<Highlighter['loadLanguage']>[0])
        const html = highlighter.codeToHtml(content, {
          lang,
          themes: { light: 'github-light', dark: 'github-dark' },
        })
        if (!cancelledRef.current) setHighlighted(html)
      })
      .catch((err) => {
        console.error('[TextPreview] shiki highlighting failed:', err)
      })

    return () => {
      cancelledRef.current = true
    }
  }, [content, filename, previewType])

  if (error) {
    return <p className="p-4 text-center text-destructive">{t('preview.loadError')}</p>
  }

  if (content === null) {
    return <p className="p-4 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  if (previewType === 'markdown') {
    return <MarkdownRenderer content={content} />
  }

  if (previewType === 'code' && highlighted) {
    return <div ref={codeRef} className="overflow-auto p-4 text-sm [&_pre]:!bg-transparent" />
  }

  return <pre className="overflow-auto whitespace-pre-wrap p-4 font-mono text-sm">{content}</pre>
}

function MarkdownRenderer({ content }: { content: string }) {
  const [Component, setComponent] = useState<React.ComponentType<{ children: string }> | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([import('react-markdown'), import('remark-gfm')]).then(
      ([{ default: ReactMarkdown }, { default: remarkGfm }]) => {
        if (cancelled) return
        setComponent(
          () =>
            function Md({ children }: { children: string }) {
              return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
            },
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (!Component) return null

  return (
    <div className="prose dark:prose-invert max-w-none overflow-auto p-4">
      <Component>{content}</Component>
    </div>
  )
}
