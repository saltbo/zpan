import { oauthResourceScopeLabels } from '@shared/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Plug, ShieldAlert, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type AgentOAuthGrant,
  getAgentOAuthConsentContext,
  listAgentOAuthGrants,
  revokeAgentOAuthGrant,
  submitAgentOAuthConsent,
} from '@/lib/api'
import { setActive, useListOrganizations } from '@/lib/auth-client'
import { redirectExternal } from '@/lib/browser-navigation'

export const Route = createFileRoute('/_authenticated/settings/agent-access')({
  component: OAuthAccessSettingsPage,
})

interface Organization {
  id: string
  name: string
}

function oauthQueryFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const query = window.location.search.slice(1)
  const params = new URLSearchParams(query)
  return params.has('client_id') && params.has('redirect_uri') ? query : ''
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null
}

function OAuthConsentPanel({ oauthQuery, organizations }: { oauthQuery: string; organizations: Organization[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const consentQuery = useQuery({
    queryKey: ['oauth-consent', oauthQuery],
    queryFn: () => getAgentOAuthConsentContext(oauthQuery),
    enabled: !!oauthQuery,
    retry: false,
  })
  const submitMutation = useMutation({
    mutationFn: (accept: boolean) => submitAgentOAuthConsent({ accept, oauthQuery }),
    onSuccess: (result) => redirectExternal(result.url),
    onError: (error) =>
      setSubmitError(error instanceof Error ? error.message : t('settings.agentAccess.oauthConsentFailed')),
  })

  async function changeWorkspace(nextOrgId: string) {
    setSwitchingOrgId(nextOrgId)
    setSubmitError(null)
    try {
      const { error } = await setActive({ organizationId: nextOrgId })
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['oauth-consent', oauthQuery] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.agentAccess.oauthWorkspaceFailed'))
    } finally {
      setSwitchingOrgId(null)
    }
  }

  if (consentQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
  }
  if (consentQuery.isError || !consentQuery.data) {
    return (
      <div className="flex max-w-3xl items-start gap-3 rounded-md border bg-background p-6">
        <ShieldAlert className="mt-0.5 size-5 text-destructive" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{t('settings.agentAccess.oauthExpiredTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.agentAccess.oauthExpiredDescription')}</p>
        </div>
      </div>
    )
  }

  const context = consentQuery.data
  const lifetimeDays = Math.round(context.grantLifetime.refreshTokenSeconds / 86400)
  return (
    <div className="max-w-3xl rounded-md border bg-background p-6 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Plug className="size-4" />
          {t('settings.agentAccess.oauthConsentEyebrow')}
        </div>
        <h1 className="text-2xl font-semibold">{t('settings.agentAccess.oauthConsentTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.agentAccess.oauthConsentDescription')}</p>
      </div>
      <dl className="mt-6 grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('settings.agentAccess.oauthClient')}</dt>
          <dd className="mt-1 font-medium">{context.clientName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('settings.agentAccess.oauthOrigin')}</dt>
          <dd className="mt-1 break-all font-medium">{context.instanceOrigin}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('settings.agentAccess.oauthReturn')}</dt>
          <dd className="mt-1 break-all font-medium">{context.redirectUri}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('settings.agentAccess.oauthLifetime')}</dt>
          <dd className="mt-1 font-medium">{t('settings.agentAccess.oauthLifetimeValue', { days: lifetimeDays })}</dd>
        </div>
      </dl>
      <div className="mt-6 space-y-2">
        <Label htmlFor="oauth-workspace">{t('settings.agentAccess.workspaceLabel')}</Label>
        <Select value={context.workspace.id} onValueChange={changeWorkspace} disabled={!!switchingOrgId}>
          <SelectTrigger id="oauth-workspace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {context.scopes.map((scope) => (
          <div key={scope} className="rounded-md border px-3 py-2 text-sm">
            {t(oauthResourceScopeLabels[scope])}
          </div>
        ))}
      </div>
      {submitError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {submitError}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={submitMutation.isPending || !!switchingOrgId}
          onClick={() => submitMutation.mutate(false)}
        >
          <X className="size-4" />
          {t('settings.agentAccess.oauthDeny')}
        </Button>
        <Button
          type="button"
          disabled={submitMutation.isPending || !!switchingOrgId}
          onClick={() => submitMutation.mutate(true)}
        >
          <Check className="size-4" />
          {submitMutation.isPending ? t('common.loading') : t('settings.agentAccess.oauthApprove')}
        </Button>
      </div>
    </div>
  )
}

function RevokeGrantDialog({ grant, onClose }: { grant: AgentOAuthGrant | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      if (grant) await revokeAgentOAuthGrant(grant.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-grants'] })
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })
  if (!grant) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.agentAccess.oauthGrantRevokeTitle')}</DialogTitle>
          <DialogDescription>
            {t('settings.agentAccess.oauthGrantRevokeConfirm', {
              client: grant.clientName,
              workspace: grant.workspaceName ?? grant.orgId,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            <Trash2 className="size-4" />
            {mutation.isPending ? t('common.loading') : t('settings.agentAccess.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OAuthGrants() {
  const { t } = useTranslation()
  const [revoking, setRevoking] = useState<AgentOAuthGrant | null>(null)
  const query = useQuery({ queryKey: ['oauth-grants'], queryFn: listAgentOAuthGrants })
  const grants = query.data?.items ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.agentAccess.oauthGrantsSection')}</CardTitle>
        <CardDescription>{t('settings.agentAccess.oauthGrantsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-destructive">{t('settings.agentAccess.oauthGrantsError')}</p>
        ) : grants.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.agentAccess.oauthNoGrants')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.agentAccess.oauthClient')}</TableHead>
                <TableHead>{t('settings.agentAccess.colWorkspace')}</TableHead>
                <TableHead>{t('settings.agentAccess.colScopes')}</TableHead>
                <TableHead>{t('settings.agentAccess.colCreated')}</TableHead>
                <TableHead>{t('settings.agentAccess.colLastUsed')}</TableHead>
                <TableHead className="w-20 text-right">{t('settings.agentAccess.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="font-medium">{grant.clientName}</TableCell>
                  <TableCell>{grant.workspaceName ?? grant.orgId}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {grant.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {t(oauthResourceScopeLabels[scope])}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(grant.createdAt)}</TableCell>
                  <TableCell>{formatDate(grant.lastUsedAt) ?? t('settings.agentAccess.never')}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('settings.agentAccess.revoke')}
                      onClick={() => setRevoking(grant)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <RevokeGrantDialog grant={revoking} onClose={() => setRevoking(null)} />
    </Card>
  )
}

export function OAuthAccessSettingsPage() {
  const { data } = useListOrganizations()
  const organizations = (data ?? []) as Organization[]
  const oauthQuery = oauthQueryFromLocation()
  if (oauthQuery) return <OAuthConsentPanel oauthQuery={oauthQuery} organizations={organizations} />
  return (
    <div className="max-w-6xl space-y-6">
      <OAuthGrants />
    </div>
  )
}
