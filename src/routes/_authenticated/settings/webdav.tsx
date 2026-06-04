import { createFileRoute, Link } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/webdav')({
  component: WebDavSettingsPage,
})

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()

  async function copy() {
    await navigator.clipboard.writeText(value)
    toast.success(t('settings.webdav.copied'))
  }

  return (
    <Button type="button" size="icon" variant="ghost" onClick={copy} aria-label={t('settings.webdav.copy')}>
      <Copy className="size-4" />
      <span className="sr-only">{t('settings.webdav.copy')}</span>
    </Button>
  )
}

function WebDavSettingsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const webDavUrl = `${origin}/dav/`
  const user = session?.user as { email?: string; username?: string } | undefined
  const username = user?.email ?? user?.username ?? ''

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.webdav.connection.section')}</CardTitle>
          <CardDescription>{t('settings.webdav.connection.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
            <Label>{t('settings.webdav.url')}</Label>
            <code className="min-w-0 break-all rounded-md bg-muted px-3 py-2 text-sm">{webDavUrl}</code>
            <CopyButton value={webDavUrl} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
            <Label>{t('settings.webdav.username')}</Label>
            <code className="min-w-0 break-all rounded-md bg-muted px-3 py-2 text-sm">{username}</code>
            <CopyButton value={username} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-4 text-sm text-muted-foreground">
            <p className="text-sm text-muted-foreground">{t('settings.webdav.instructions')}</p>
            <Link to="/settings/api-keys" className="text-primary underline-offset-4 hover:underline">
              {t('settings.apiKeys.manage')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
