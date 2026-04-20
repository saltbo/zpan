import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShareLandingResponse } from '@/lib/api'
import { getShareLanding } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { FilePreview } from './file-preview'
import { FolderBrowser } from './folder-browser'
import { PasswordPrompt } from './password-prompt'
import { SaveToDriveDialog } from './save-to-drive-dialog'
import type { ShareErrorCode } from './share-error'
import { ShareError } from './share-error'

interface ShareLandingProps {
  token: string
}

function resolveError(share: ShareLandingResponse): ShareErrorCode | null {
  if (share.expired) return 'expired'
  if (share.exhausted) return 'exhausted'
  return null
}

export function ShareLanding({ token }: ShareLandingProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const isLoggedIn = !!session?.user
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [showPasswordAfterSave, setShowPasswordAfterSave] = useState(false)

  const query = useQuery<ShareLandingResponse, { status?: number }>({
    queryKey: ['share-landing', token],
    queryFn: () => getShareLanding(token),
    retry: false,
  })

  function handleUnlocked() {
    queryClient.invalidateQueries({ queryKey: ['share-landing', token] })
  }

  function handlePasswordRequired() {
    setShowPasswordAfterSave(true)
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">{t('share.loading')}</div>
    )
  }

  if (query.isError) {
    const err = query.error as { status?: number }
    const code = err?.status === 410 ? 'gone' : 'not-found'
    return <ShareError code={code} />
  }

  const share = query.data!

  if (showPasswordAfterSave || share.requiresPassword) {
    return (
      <PasswordPrompt
        token={token}
        fileName={share.matterName}
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

  return (
    <>
      {share.isFolder ? (
        <FolderBrowser
          token={token}
          share={share}
          isLoggedIn={isLoggedIn}
          onSaveToDrive={isLoggedIn ? () => setSaveDialogOpen(true) : undefined}
        />
      ) : (
        <FilePreview
          token={token}
          share={share}
          isLoggedIn={isLoggedIn}
          onSaveToDrive={isLoggedIn ? () => setSaveDialogOpen(true) : undefined}
        />
      )}
      {isLoggedIn && (
        <SaveToDriveDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          token={token}
          onPasswordRequired={handlePasswordRequired}
        />
      )}
    </>
  )
}
