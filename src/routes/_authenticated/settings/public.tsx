import { createFileRoute } from '@tanstack/react-router'
import { ExternalLinkIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/public')({
  component: PublicPage,
})

function PublicPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const username = session?.user?.username as string | undefined

  return (
    <div className="max-w-lg">
      <div className="space-y-4 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">{t('settings.publicProfile.section')}</h3>
          {username && (
            <a
              href={`/u/${username}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              /u/{username}
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.publicProfile.hint')}</p>
      </div>
    </div>
  )
}
