import { createFileRoute, Link } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useEntitlement } from '@/hooks/useEntitlement'
import { stremThruAddress } from '@/lib/stremthru'

export const Route = createFileRoute('/_authenticated/teams/$teamId/stremthru')({
  component: StremThruSettingsPage,
})

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()

  async function copy() {
    await navigator.clipboard.writeText(value)
    toast.success(t('teams.stremthru.copied'))
  }

  return (
    <Button type="button" size="icon" variant="ghost" onClick={copy} aria-label={t('teams.stremthru.copy')}>
      <Copy className="size-4" />
      <span className="sr-only">{t('teams.stremthru.copy')}</span>
    </Button>
  )
}

function ConnectionCard() {
  const { t } = useTranslation()
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const address = stremThruAddress(origin)
  const tokenPattern = `${address}|torbox:<key>`

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('teams.stremthru.connection.title')}</CardTitle>
        <CardDescription>{t('teams.stremthru.connection.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
          <Label>{t('teams.stremthru.address')}</Label>
          <code className="min-w-0 break-all rounded-md bg-muted px-3 py-2 text-sm" data-testid="stremthru-address">
            {address}
          </code>
          <CopyButton value={address} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('teams.stremthru.mediaFusion.title')}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t('teams.stremthru.mediaFusion.store')}</li>
            <li>
              {t('teams.stremthru.mediaFusion.token', { token: tokenPattern, interpolation: { escapeValue: false } })}
            </li>
            <li>{t('teams.stremthru.mediaFusion.serviceUrl')}</li>
          </ol>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-4 text-sm text-muted-foreground">
          <p>{t('teams.stremthru.keyHint')}</p>
          <Link to="/settings/api-keys" className="text-primary underline-offset-4 hover:underline">
            {t('settings.apiKeys.manage')}
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export function StremThruSettingsPage() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()

  if (entitlementLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  if (!hasFeature('torrents')) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{t('teams.tabStremThru')}</h2>
          <ProBadge />
        </div>
        <UpgradeHint feature="torrents" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <ConnectionCard />
    </div>
  )
}
