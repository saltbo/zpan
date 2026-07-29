import { type AgentGrantableScope, agentApiKeyShortcutOptions, agentScopeLabels } from '@shared/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, KeyRound, Plug, Plus, RotateCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type AgentApiKey,
  type AgentOAuthGrant,
  createAgentApiKey,
  getAgentOAuthConsentContext,
  listAgentApiKeys,
  listAgentOAuthGrants,
  revokeAgentApiKey,
  revokeAgentOAuthGrant,
  rotateAgentApiKey,
  submitAgentOAuthConsent,
} from '@/lib/api'
import { setActive, useListOrganizations } from '@/lib/auth-client'
import { redirectExternal } from '@/lib/browser-navigation'

export const Route = createFileRoute('/_authenticated/settings/agent-access')({
  component: AgentAccessSettingsPage,
})

interface Organization {
  id: string
  name: string
}

interface RevealedKey {
  name: string
  key: string
}

const allAgentScopes = Object.keys(agentScopeLabels) as AgentGrantableScope[]

function defaultExpiryDate(): string {
  const date = new Date()
  date.setDate(date.getDate() + 90)
  return date.toISOString().slice(0, 10)
}

function expiryDateToIso(value: string): string {
  return new Date(`${value}T23:59:59.000Z`).toISOString()
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null
}

function oauthQueryFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const query = window.location.search.slice(1)
  const params = new URLSearchParams(query)
  return params.has('client_id') && params.has('redirect_uri') ? query : ''
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={t('settings.agentAccess.copy')}
      onClick={async () => {
        await navigator.clipboard.writeText(value)
        toast.success(t('settings.agentAccess.copied'))
      }}
    >
      <Copy className="size-4" />
      <span className="sr-only">{t('settings.agentAccess.copy')}</span>
    </Button>
  )
}

function CreateAgentKeyDialog({
  open,
  orgId,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  orgId: string
  onOpenChange: (open: boolean) => void
  onCreated: (key: RevealedKey) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [expiryDate, setExpiryDate] = useState(defaultExpiryDate)
  const [scopes, setScopes] = useState<AgentGrantableScope[]>(agentApiKeyShortcutOptions[0]?.scopes ?? [])

  const createMutation = useMutation({
    mutationFn: () =>
      createAgentApiKey(orgId, {
        name: name.trim(),
        scopes,
        expiresAt: expiryDateToIso(expiryDate),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['agent-api-keys', orgId] })
      onCreated({ name: result.item.name, key: result.key })
      setName('')
      setExpiryDate(defaultExpiryDate())
      setScopes(agentApiKeyShortcutOptions[0]?.scopes ?? [])
      onOpenChange(false)
      toast.success(t('settings.agentAccess.createSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  function toggleScope(scope: AgentGrantableScope, checked: boolean) {
    setScopes((current) => (checked ? [...current, scope] : current.filter((item) => item !== scope)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('settings.agentAccess.createTitle')}</DialogTitle>
          <DialogDescription>{t('settings.agentAccess.createDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="agent-key-name">{t('settings.agentAccess.nameLabel')}</Label>
            <Input
              id="agent-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.agentAccess.namePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-key-expiry">{t('settings.agentAccess.expiryLabel')}</Label>
            <Input
              id="agent-key-expiry"
              type="date"
              value={expiryDate}
              max={oneYearDate()}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('settings.agentAccess.shortcutsLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              {agentApiKeyShortcutOptions.map((shortcut) => (
                <Button
                  key={shortcut.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setScopes([...shortcut.scopes])}
                >
                  {t(`settings.agentAccess.shortcut.${shortcut.id}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {allAgentScopes.map((scope) => {
              const checkboxId = `agent-key-scope-${scope}`
              return (
                <div key={scope} className="flex min-h-10 items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    id={checkboxId}
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) => toggleScope(scope, !!checked)}
                  />
                  <Label htmlFor={checkboxId} className="font-normal">
                    {t(agentScopeLabels[scope])}
                  </Label>
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!orgId || !name.trim() || scopes.length === 0 || !expiryDate || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus className="size-4" />
            {createMutation.isPending ? t('common.loading') : t('settings.agentAccess.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function oneYearDate(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + 1)
  return date.toISOString().slice(0, 10)
}

function RevealedKeyDialog({ revealedKey, onClose }: { revealedKey: RevealedKey | null; onClose: () => void }) {
  const { t } = useTranslation()
  if (!revealedKey) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.agentAccess.revealedTitle')}</DialogTitle>
          <DialogDescription>{t('settings.agentAccess.revealedWarning')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{revealedKey.name}</Label>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 break-all text-sm">{revealedKey.key}</code>
            <CopyButton value={revealedKey.key} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeAgentKeyDialog({ apiKey, onClose }: { apiKey: AgentApiKey | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey) return
      await revokeAgentApiKey(apiKey.orgId, apiKey.id)
    },
    onSuccess: () => {
      if (apiKey) queryClient.invalidateQueries({ queryKey: ['agent-api-keys', apiKey.orgId] })
      toast.success(t('settings.agentAccess.revokeSuccess'))
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })
  if (!apiKey) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.agentAccess.revokeTitle')}</DialogTitle>
          <DialogDescription>{t('settings.agentAccess.revokeConfirm', { name: apiKey.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            <Trash2 className="size-4" />
            {revokeMutation.isPending ? t('common.loading') : t('settings.agentAccess.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeAgentOAuthGrantDialog({ grant, onClose }: { grant: AgentOAuthGrant | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!grant) return
      await revokeAgentOAuthGrant(grant.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-oauth-grants'] })
      toast.success(t('settings.agentAccess.oauthGrantRevokeSuccess'))
      onClose()
    },
    onError: (err) => toast.error(err.message),
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
          <Button
            type="button"
            variant="destructive"
            disabled={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            <Trash2 className="size-4" />
            {revokeMutation.isPending ? t('common.loading') : t('settings.agentAccess.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AgentOAuthConsentPanel({ oauthQuery, organizations }: { oauthQuery: string; organizations: Organization[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const consentQuery = useQuery({
    queryKey: ['agent-oauth-consent', oauthQuery],
    queryFn: () => getAgentOAuthConsentContext(oauthQuery),
    enabled: !!oauthQuery,
    retry: false,
  })
  const submitMutation = useMutation({
    mutationFn: (accept: boolean) => submitAgentOAuthConsent({ accept, oauthQuery }),
    onSuccess: (result) => redirectExternal(result.url),
    onError: (err) => setSubmitError(err instanceof Error ? err.message : t('settings.agentAccess.oauthConsentFailed')),
  })

  async function changeWorkspace(nextOrgId: string) {
    setSwitchingOrgId(nextOrgId)
    setSubmitError(null)
    try {
      const { error } = await setActive({ organizationId: nextOrgId })
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['agent-oauth-consent', oauthQuery] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.agentAccess.oauthWorkspaceFailed'))
    } finally {
      setSwitchingOrgId(null)
    }
  }

  if (consentQuery.isLoading) {
    return (
      <div className="max-w-3xl rounded-md border bg-background p-6">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (consentQuery.isError || !consentQuery.data) {
    return (
      <div className="max-w-3xl rounded-md border bg-background p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 text-destructive" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">{t('settings.agentAccess.oauthExpiredTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('settings.agentAccess.oauthExpiredDescription')}</p>
          </div>
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
        <Label htmlFor="agent-oauth-workspace">{t('settings.agentAccess.workspaceLabel')}</Label>
        <Select value={context.workspace.id} onValueChange={changeWorkspace} disabled={!!switchingOrgId}>
          <SelectTrigger id="agent-oauth-workspace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 space-y-3">
        <h2 className="text-base font-semibold">{t('settings.agentAccess.oauthScopesTitle')}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {context.scopes.map((scope) => (
            <div key={scope} className="rounded-md border px-3 py-2 text-sm">
              {t(agentScopeLabels[scope])}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.agentAccess.oauthEffects')}</p>
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

function AgentOAuthGrantsSection() {
  const { t } = useTranslation()
  const [revokingGrant, setRevokingGrant] = useState<AgentOAuthGrant | null>(null)
  const grantsQuery = useQuery({
    queryKey: ['agent-oauth-grants'],
    queryFn: listAgentOAuthGrants,
  })
  const grants = grantsQuery.data?.items ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.agentAccess.oauthGrantsSection')}</CardTitle>
        <CardDescription>{t('settings.agentAccess.oauthGrantsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {grantsQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : grantsQuery.isError ? (
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
                <TableHead>{t('settings.agentAccess.colStatus')}</TableHead>
                <TableHead className="w-20 text-right">{t('settings.agentAccess.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((grant) => (
                <TableRow key={grant.id}>
                  <TableCell className="font-medium">{grant.clientName}</TableCell>
                  <TableCell>{grant.workspaceName ?? grant.orgId}</TableCell>
                  <TableCell>
                    <div className="flex max-w-md flex-wrap gap-1">
                      {grant.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {t(agentScopeLabels[scope])}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(grant.createdAt)}</TableCell>
                  <TableCell>{formatDate(grant.lastUsedAt) ?? t('settings.agentAccess.never')}</TableCell>
                  <TableCell>
                    <Badge>{t('settings.agentAccess.status.active')}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('settings.agentAccess.revoke')}
                      onClick={() => setRevokingGrant(grant)}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">{t('settings.agentAccess.revoke')}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <RevokeAgentOAuthGrantDialog grant={revokingGrant} onClose={() => setRevokingGrant(null)} />
    </Card>
  )
}

export function AgentAccessSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: organizationData } = useListOrganizations()
  const organizations = (organizationData ?? []) as Organization[]
  const oauthQuery = oauthQueryFromLocation()
  const [orgId, setOrgId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<RevealedKey | null>(null)
  const [revoking, setRevoking] = useState<AgentApiKey | null>(null)

  useEffect(() => {
    if (!orgId && organizations[0]) setOrgId(organizations[0].id)
  }, [orgId, organizations])

  const keysQuery = useQuery({
    queryKey: ['agent-api-keys', orgId],
    queryFn: () => listAgentApiKeys(orgId),
    enabled: !!orgId,
  })

  const rows = keysQuery.data?.items ?? []

  async function rotate(apiKey: AgentApiKey) {
    try {
      const result = await rotateAgentApiKey(apiKey.orgId, apiKey.id)
      queryClient.invalidateQueries({ queryKey: ['agent-api-keys', apiKey.orgId] })
      setRevealedKey({ name: result.item.name, key: result.key })
      toast.success(t('settings.agentAccess.rotateSuccess'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  if (oauthQuery) return <AgentOAuthConsentPanel oauthQuery={oauthQuery} organizations={organizations} />

  return (
    <div className="max-w-6xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.agentAccess.section')}</CardTitle>
          <CardDescription>{t('settings.agentAccess.description')}</CardDescription>
          <CardAction>
            <Button
              type="button"
              disabled={!orgId || keysQuery.isLoading || keysQuery.isError}
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" />
              {t('settings.agentAccess.create')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-sm space-y-2">
            <Label htmlFor="agent-access-workspace">{t('settings.agentAccess.workspaceLabel')}</Label>
            <Select value={orgId} onValueChange={setOrgId}>
              <SelectTrigger id="agent-access-workspace">
                <SelectValue placeholder={t('settings.agentAccess.workspacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {keysQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : keysQuery.isError ? (
            <p className="py-6 text-center text-sm text-destructive">{t('settings.agentAccess.managementRequired')}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.agentAccess.noKeys')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.agentAccess.colName')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colWorkspace')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colScopes')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colCreated')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colExpires')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colLastUsed')}</TableHead>
                  <TableHead>{t('settings.agentAccess.colStatus')}</TableHead>
                  <TableHead className="w-24 text-right">{t('settings.agentAccess.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        <KeyRound className="size-4 text-muted-foreground" />
                        {row.name}
                      </div>
                    </TableCell>
                    <TableCell>{row.workspaceName ?? row.orgId}</TableCell>
                    <TableCell>
                      <div className="flex max-w-md flex-wrap gap-1">
                        {row.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {t(agentScopeLabels[scope])}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{formatDate(row.expiresAt)}</TableCell>
                    <TableCell>{formatDate(row.lastUsedAt) ?? t('settings.agentAccess.never')}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                        {t(`settings.agentAccess.status.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === 'active' ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('settings.agentAccess.rotate')}
                          onClick={() => rotate(row)}
                        >
                          <RotateCw className="size-4" />
                          <span className="sr-only">{t('settings.agentAccess.rotate')}</span>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t('settings.agentAccess.revoke')}
                        onClick={() => setRevoking(row)}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">{t('settings.agentAccess.revoke')}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <CreateAgentKeyDialog open={createOpen} orgId={orgId} onOpenChange={setCreateOpen} onCreated={setRevealedKey} />
      <RevealedKeyDialog revealedKey={revealedKey} onClose={() => setRevealedKey(null)} />
      <RevokeAgentKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} />
      <AgentOAuthGrantsSection />
    </div>
  )
}
