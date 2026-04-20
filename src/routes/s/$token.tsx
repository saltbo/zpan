import type { ShareView } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PasswordPrompt } from '@/components/share/password-prompt'
import { ShareError, type ShareErrorCode } from '@/components/share/share-error'
import { ShareLanding } from '@/components/share/share-landing'
import { DEFAULT_SHARE_LAYOUT, useShareLayoutState } from '@/components/share/share-layout-state'
import { getShare } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/s/$token')({
  component: SharePage,
})

function resolveError(share: ShareView): ShareErrorCode | null {
  if (share.expired) return 'expired'
  if (share.exhausted) return 'exhausted'
  return null
}

function formatExpiry(expiresAt: string | null, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!expiresAt) return null
  return t('share.expiresOn', { date: new Date(expiresAt).toLocaleDateString() })
}

function sameLayout(
  a: { title: string; subtitle: string; meta: string[] },
  b: { title: string; subtitle: string; meta: string[] },
) {
  return (
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.meta.length === b.meta.length &&
    a.meta.every((item, index) => item === b.meta[index])
  )
}

function SharePage() {
  const { t } = useTranslation()
  const { token } = Route.useParams()
  const queryClient = useQueryClient()
  const { setLayout } = useShareLayoutState()
  const [showPasswordAfterSave, setShowPasswordAfterSave] = useState(false)
  const [shareReady, setShareReady] = useState(false)

  const query = useQuery<ShareView, { status?: number }>({
    queryKey: ['share', token],
    queryFn: () => getShare(token),
    retry: false,
  })

  useEffect(() => {
    setShareReady(false)
    setShowPasswordAfterSave(false)
    const nextLayout = {
      ...DEFAULT_SHARE_LAYOUT,
      title: t('share.externalLabel'),
      subtitle: t('share.loading'),
      meta: [],
    }
    setLayout((prev) => (sameLayout(prev, nextLayout) ? prev : nextLayout))
  }, [setLayout, t])

  useEffect(() => {
    if (query.isSuccess && !query.isFetching) {
      setShareReady(true)
    }
  }, [query.isSuccess, query.isFetching])

  const share = query.data
  const meta = useMemo(
    () =>
      share == null
        ? []
        : ([
            t('share.sharedBy', { name: share.creatorName }),
            share.matter.isFolder ? t('share.folderTitle') : formatSize(share.matter.size),
            formatExpiry(share.expiresAt, t),
          ].filter(Boolean) as string[]),
    [share, t],
  )

  const desiredLayout = useMemo(() => {
    if (!share) {
      return null
    }

    if (showPasswordAfterSave || share.requiresPassword) {
      return {
        title: share.matter.name,
        subtitle: t('share.passwordDesc'),
        meta: [],
      }
    }

    if (resolveError(share)) {
      return {
        title: share.matter.name,
        subtitle: t('share.shareUnavailable'),
        meta: [],
      }
    }

    return {
      title: share.matter.name,
      subtitle: share.matter.isFolder ? t('share.externalFolderSubtitle') : t('share.externalFileSubtitle'),
      meta,
    }
  }, [meta, share, showPasswordAfterSave, t])

  useEffect(() => {
    if (!desiredLayout) return
    setLayout((prev) => (sameLayout(prev, desiredLayout) ? prev : desiredLayout))
  }, [desiredLayout, setLayout])

  function handleUnlocked() {
    setShareReady(false)
    queryClient.invalidateQueries({ queryKey: ['share', token] })
  }

  if (query.isLoading || (query.isFetching && !shareReady)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">{t('share.loading')}</div>
    )
  }

  if (query.isError) {
    const err = query.error as { status?: number }
    const code = err?.status === 410 ? 'gone' : 'not-found'
    return <ShareError code={code} />
  }

  if (!share) return null

  if (showPasswordAfterSave || share.requiresPassword) {
    return (
      <PasswordPrompt
        token={token}
        fileName={share.matter.name}
        onUnlocked={() => {
          setShowPasswordAfterSave(false)
          handleUnlocked()
        }}
      />
    )
  }

  const errorCode = resolveError(share)
  if (errorCode) {
    return <ShareError code={errorCode} />
  }

  return <ShareLanding token={token} share={share} onPasswordRequired={() => setShowPasswordAfterSave(true)} />
}
