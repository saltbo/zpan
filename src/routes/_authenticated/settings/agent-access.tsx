import { type AgentGrantableScope, agentApiKeyShortcutOptions, agentScopeLabels } from '@shared/schemas'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, KeyRound, Plus, RotateCw, Trash2 } from 'lucide-react'
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
import { type AgentApiKey, createAgentApiKey, listAgentApiKeys, revokeAgentApiKey, rotateAgentApiKey } from '@/lib/api'
import { useListOrganizations } from '@/lib/auth-client'

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
                    {t(`settings.agentAccess.scope.${scope}`)}
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

export function AgentAccessSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: organizationData } = useListOrganizations()
  const organizations = (organizationData ?? []) as Organization[]
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

  return (
    <div className="max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.agentAccess.section')}</CardTitle>
          <CardDescription>{t('settings.agentAccess.description')}</CardDescription>
          <CardAction>
            <Button type="button" disabled={!orgId} onClick={() => setCreateOpen(true)}>
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
                            {t(`settings.agentAccess.scope.${scope}`)}
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
    </div>
  )
}
