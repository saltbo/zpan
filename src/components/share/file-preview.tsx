import type { ShareView } from '@shared/types'
import { Download, File } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { buildShareObjectUrl } from '@/lib/api'
import { formatSize } from '@/lib/format'

interface FilePreviewProps {
  token: string
  share: ShareView
  onSaveToDrive?: () => void
  isLoggedIn: boolean
}

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'other'

function detectPreviewKind(mimeType: string): PreviewKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'other'
}

interface MediaPreviewProps {
  downloadUrl: string
  kind: PreviewKind
}

function MediaPreview({ downloadUrl, kind }: MediaPreviewProps) {
  const { t } = useTranslation()
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)

    // NOTE: no `credentials: 'include'` — the endpoint 302-redirects to an R2
    // presigned URL authenticated by signature. With credentials, the browser
    // rejects the redirect because R2 returns `Access-Control-Allow-Origin: *`
    // which may not combine with credentialed requests.
    fetch(downloadUrl, { redirect: 'follow' })
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed')
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setObjectUrl(url)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [downloadUrl])

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">{t('share.loading')}</div>
  }

  if (error || !objectUrl) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <p>{t('share.previewUnavailable')}</p>
        <p className="text-sm">{t('share.previewDownloadHint')}</p>
      </div>
    )
  }

  if (kind === 'image') {
    return <img src={objectUrl} alt="" className="max-h-[70vh] w-full rounded-md object-contain" />
  }

  if (kind === 'video') {
    return (
      <video controls src={objectUrl} className="max-h-[70vh] w-full rounded-md">
        <track kind="captions" />
      </video>
    )
  }

  if (kind === 'audio') {
    return (
      <audio controls src={objectUrl} className="w-full">
        <track kind="captions" />
      </audio>
    )
  }

  if (kind === 'pdf') {
    return <embed src={objectUrl} type="application/pdf" className="h-[70vh] w-full rounded-md border" />
  }

  return null
}

export function FilePreview({ token, share, onSaveToDrive, isLoggedIn }: FilePreviewProps) {
  const { t } = useTranslation()
  const kind = detectPreviewKind(share.matter.type)
  const downloadUrl = buildShareObjectUrl(token, share.rootRef)

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
            <File className="h-4 w-4 text-muted-foreground" />
          </div>
          <span>{formatSize(share.matter.size)}</span>
        </div>
        <div className="flex gap-2">
          {isLoggedIn && onSaveToDrive && (
            <Button variant="outline" size="sm" onClick={onSaveToDrive}>
              {t('share.saveToDrive')}
            </Button>
          )}
          <Button asChild size="sm">
            <a href={downloadUrl} download>
              <Download className="mr-2 h-4 w-4" />
              {t('share.download')}
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
        {kind === 'other' ? (
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <File className="h-16 w-16" />
            <p>{t('share.previewUnavailable')}</p>
            <p className="text-sm">{t('share.previewDownloadHint')}</p>
          </div>
        ) : (
          <MediaPreview downloadUrl={downloadUrl} kind={kind} />
        )}
      </div>
    </div>
  )
}
