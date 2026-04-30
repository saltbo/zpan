import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface OfficePreviewProps {
  url: string
  filename: string
}

function toAbsoluteUrl(url: string): string {
  return new URL(url, window.location.origin).href
}

function shouldResolveDownloadUrl(url: string): boolean {
  const absoluteUrl = toAbsoluteUrl(url)
  return new URL(absoluteUrl).origin === window.location.origin && absoluteUrl.includes('/api/shares/')
}

function withDownloadUrlQuery(url: string): string {
  const target = new URL(url, window.location.origin)
  target.searchParams.set('downloadUrl', '1')
  return target.href
}

export function buildOfficeViewerUrl(url: string): string {
  const absoluteUrl = toAbsoluteUrl(url)
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}`
}

export function OfficePreview({ url, filename }: OfficePreviewProps) {
  const { t } = useTranslation()
  const [resolvedUrl, setResolvedUrl] = useState(url)
  const [error, setError] = useState(false)
  const needsResolution = shouldResolveDownloadUrl(url)
  const [resolving, setResolving] = useState(needsResolution)
  const absoluteUrl = toAbsoluteUrl(resolvedUrl)
  const viewerUrl = useMemo(() => buildOfficeViewerUrl(resolvedUrl), [resolvedUrl])
  const isLocalUrl = absoluteUrl.startsWith('http://localhost') || absoluteUrl.startsWith('http://127.0.0.1')

  useEffect(() => {
    let cancelled = false
    setResolvedUrl(url)
    setError(false)
    setResolving(shouldResolveDownloadUrl(url))

    if (!shouldResolveDownloadUrl(url)) return

    fetch(withDownloadUrlQuery(url), { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to resolve download URL')
        return res.json() as Promise<{ downloadUrl?: string }>
      })
      .then((body) => {
        if (!cancelled && body.downloadUrl) setResolvedUrl(body.downloadUrl)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setResolving(false)
      })

    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div className="flex h-full min-h-96 flex-col bg-background">
      {error && <div className="border-b px-4 py-2 text-sm text-destructive">{t('preview.loadError')}</div>}
      {!resolving && isLocalUrl && (
        <div className="border-b bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          {t('preview.officeLocalHint')}
        </div>
      )}
      {resolving ? (
        <div className="flex min-h-96 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : (
        <iframe
          title={filename}
          src={viewerUrl}
          className="min-h-96 flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
      )}
    </div>
  )
}
