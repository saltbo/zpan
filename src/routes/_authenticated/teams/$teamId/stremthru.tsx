import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Copy } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getTorrentCacheConfig, replaceTorrentCacheConfig } from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'
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

function TorrentFolderCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['torrent-cache', 'config', orgId]
  const configQuery = useQuery({ queryKey, queryFn: getTorrentCacheConfig })
  const [folder, setFolder] = useState('')
  const saved = configQuery.data?.folder ?? ''

  useEffect(() => {
    setFolder(saved)
  }, [saved])

  const saveMutation = useMutation({
    mutationFn: (value: string) => replaceTorrentCacheConfig({ folder: value }),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKey, config)
      setFolder(config.folder)
      toast.success(t('teams.stremthru.folder.saved'))
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    saveMutation.mutate(folder)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('teams.stremthru.folder.title')}</CardTitle>
        <CardDescription>{t('teams.stremthru.folder.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {configQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : configQuery.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <span>{t('teams.stremthru.folder.loadError')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => configQuery.refetch()}>
              {t('teams.stremthru.folder.retry')}
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="torrent-folder">{t('teams.stremthru.folder.label')}</Label>
              <Input
                id="torrent-folder"
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder={t('teams.stremthru.folder.placeholder')}
                disabled={!canEdit}
                aria-invalid={saveMutation.error ? true : undefined}
                aria-describedby={saveMutation.error ? 'torrent-folder-error' : undefined}
              />
              {saveMutation.error ? (
                <p id="torrent-folder-error" className="text-xs text-destructive">
                  {saveMutation.error.message}
                </p>
              ) : null}
              {canEdit ? null : <p className="text-xs text-muted-foreground">{t('teams.stremthru.folder.readOnly')}</p>}
            </div>
            {canEdit ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={saveMutation.isPending || folder.trim() === saved}>
                  {saveMutation.isPending ? t('common.loading') : t('teams.stremthru.folder.save')}
                </Button>
              </div>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
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
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()

  const orgId = activeOrg?.id
  const currentUserId = session?.user?.id
  const myMembership = activeOrg?.members?.find((m: { userId: string; role: string }) => m.userId === currentUserId)
  const isOwnerOrAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  if (entitlementLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  if (!hasFeature('torrent_cache')) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">{t('teams.tabStremThru')}</h2>
          <ProBadge />
        </div>
        <UpgradeHint feature="torrent_cache" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {orgId ? <TorrentFolderCard orgId={orgId} canEdit={isOwnerOrAdmin} /> : null}
      <ConnectionCard />
    </div>
  )
}
