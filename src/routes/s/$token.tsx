import type { ShareView } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PasswordPrompt } from '@/components/share/password-prompt'
import { ShareError, type ShareErrorCode } from '@/components/share/share-error'
import { ShareLanding } from '@/components/share/share-landing'
import { getShare } from '@/lib/api'

export const Route = createFileRoute('/s/$token')({
  component: SharePage,
})

function resolveError(share: ShareView): ShareErrorCode | null {
  if (share.expired) return 'expired'
  if (share.exhausted) return 'exhausted'
  return null
}

function SharePage() {
  const { t } = useTranslation()
  const { token } = Route.useParams()
  const queryClient = useQueryClient()
  const [showPasswordAfterSave, setShowPasswordAfterSave] = useState(false)

  const query = useQuery<ShareView, { status?: number }>({
    queryKey: ['share', token],
    queryFn: () => getShare(token),
    retry: false,
  })

  const share = query.data

  function handleUnlocked() {
    queryClient.invalidateQueries({ queryKey: ['share', token] })
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-muted-foreground" role="status">
        {t('share.loading')}
      </div>
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
