import { DEFAULT_SITE_NAME } from '@shared/constants'
import type { OAuthConsentContext } from '@shared/schemas'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, ExternalLink, LockKeyhole, ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OAuthScopeList } from '@/components/oauth-scope-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useSiteConfig } from '@/hooks/use-site-config'
import { getOAuthConsentContext, submitOAuthConsent } from '@/lib/api'
import { redirectExternal } from '@/lib/browser-navigation'

export const Route = createFileRoute('/oauth/consent')({ component: OAuthConsentPage })

function oauthQueryFromLocation(): string {
  return typeof window === 'undefined' ? '' : window.location.search.slice(1)
}

export function requestedConsentScopes(context: Pick<OAuthConsentContext, 'standardScopes' | 'scopes'>): string[] {
  return [...context.standardScopes, ...context.scopes]
}

export function OAuthConsentPage() {
  const { t } = useTranslation()
  const { data: siteConfig } = useSiteConfig()
  const siteName = siteConfig?.site.name ?? DEFAULT_SITE_NAME
  const [oauthQuery] = useState(oauthQueryFromLocation)
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const consentQuery = useQuery({
    queryKey: ['oauth-consent', oauthQuery],
    queryFn: () => getOAuthConsentContext(oauthQuery),
    enabled: oauthQuery.length > 0,
    retry: false,
  })
  useEffect(() => {
    if (consentQuery.data?.requestedWorkspaceIds.length) {
      setSelectedWorkspaceIds(consentQuery.data.requestedWorkspaceIds)
    }
  }, [consentQuery.data])
  const submitMutation = useMutation({
    mutationFn: (accept: boolean) =>
      submitOAuthConsent({
        accept,
        oauthQuery,
        workspaceIds: accept ? selectedWorkspaceIds : [],
      }),
    onSuccess: (result) => redirectExternal(result.url),
    onError: (error) =>
      setSubmitError(error instanceof Error ? error.message : t('settings.oauthApps.oauthConsentFailed')),
  })

  if (consentQuery.isLoading) {
    return <p className="mx-auto max-w-xl py-20 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (consentQuery.isError || !consentQuery.data) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader className="flex-row items-start gap-3">
          <ShieldAlert className="mt-1 size-5 text-destructive" />
          <div>
            <h1 className="leading-none font-semibold">{t('settings.oauthApps.oauthExpiredTitle')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('settings.oauthApps.oauthExpiredDescription')}</p>
          </div>
        </CardHeader>
      </Card>
    )
  }

  const context = consentQuery.data
  const requestedScopes = requestedConsentScopes(context)
  const lifetimeDays = Math.round(context.grantLifetime.refreshTokenSeconds / 86400)
  const selectionLocked = context.requestedWorkspaceIds.length > 0

  function toggleWorkspace(id: string, checked: boolean) {
    setSubmitError(null)
    setSelectedWorkspaceIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)))
  }

  return (
    <Card className="mx-auto max-w-2xl shadow-lg">
      <CardHeader className="flex-row items-start gap-4 space-y-0">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <LockKeyhole className="size-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{siteName}</p>
          <h1 className="text-2xl leading-tight font-semibold">
            {t('settings.oauthApps.oauthWantsAccess', { client: context.clientName })}
          </h1>
          <p className="text-sm text-muted-foreground">{t('settings.oauthApps.oauthReviewAccess')}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <p className="text-muted-foreground">{t('settings.oauthApps.oauthApplicationOrigin')}</p>
            <p className="truncate font-medium">{context.clientOrigin}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{t('settings.oauthApps.oauthAccessDuration')}</p>
            <p className="font-medium">{t('settings.oauthApps.oauthAccessDurationValue', { days: lifetimeDays })}</p>
          </div>
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="font-medium">{t('settings.oauthApps.oauthWorkspaceAccess')}</h2>
            <p className="text-sm text-muted-foreground">{t('settings.oauthApps.oauthWorkspaceHelp')}</p>
          </div>
          <div className="space-y-2">
            {context.workspaces.map((workspace) => (
              <Label
                key={workspace.id}
                htmlFor={`workspace-${workspace.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal"
              >
                <Checkbox
                  id={`workspace-${workspace.id}`}
                  checked={selectedWorkspaceIds.includes(workspace.id)}
                  disabled={selectionLocked}
                  onCheckedChange={(checked) => toggleWorkspace(workspace.id, checked === true)}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{workspace.name ?? workspace.id}</span>
              </Label>
            ))}
          </div>
        </section>

        <Separator />

        <section className="space-y-3" aria-labelledby="oauth-consent-permissions">
          <div>
            <h2 id="oauth-consent-permissions" className="font-medium">
              {t('settings.oauthApps.oauthPermissions')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('settings.oauthApps.permissionCount', { count: requestedScopes.length })}
            </p>
          </div>
          <ScrollArea className="h-80 rounded-lg border bg-muted/10 p-3">
            <OAuthScopeList scopes={requestedScopes} className="pr-3" />
          </ScrollArea>
        </section>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ExternalLink className="size-3.5" aria-hidden="true" />
          {t('settings.oauthApps.oauthReturnNotice', { origin: new URL(context.redirectUri).origin })}
        </p>
        {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
      </CardContent>
      <CardFooter className="flex flex-col-reverse gap-2 border-t sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate(false)}>
          <X className="size-4" aria-hidden="true" />
          {t('settings.oauthApps.oauthDeny')}
        </Button>
        <Button
          disabled={submitMutation.isPending || selectedWorkspaceIds.length === 0}
          onClick={() => submitMutation.mutate(true)}
        >
          <Check className="size-4" aria-hidden="true" />
          {submitMutation.isPending ? t('common.loading') : t('settings.oauthApps.oauthApprove')}
        </Button>
      </CardFooter>
    </Card>
  )
}
