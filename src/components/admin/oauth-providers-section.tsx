import { BUILTIN_PROVIDER_IDS, OAuthProviderMeta } from '@shared/oauth-providers'
import type { AuthProvider } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { OAuthProviderIcon } from '@/components/oauth-provider-icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useClipboard } from '@/hooks/use-clipboard'
import { deleteAuthProvider, listAuthProviders, upsertAuthProvider } from '@/lib/api'

const providersQueryKey = ['admin', 'auth-providers'] as const

type ProviderType = 'builtin' | 'oidc'

interface FormState {
  type: ProviderType
  providerId: string
  clientId: string
  clientSecret: string
  enabled: boolean
  discoveryUrl: string
  scopes: string
}

const emptyForm: FormState = {
  type: 'builtin',
  providerId: '',
  clientId: '',
  clientSecret: '',
  enabled: true,
  discoveryUrl: '',
  scopes: '',
}

function providerName(providerId: string): string {
  return OAuthProviderMeta[providerId]?.name ?? providerId
}

function providerIcon(providerId: string): string {
  return OAuthProviderMeta[providerId]?.icon ?? providerId
}

function ProviderLabel({ providerId }: { providerId: string }) {
  const name = providerName(providerId)

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <OAuthProviderIcon icon={providerIcon(providerId)} name={name} />
      <span className="truncate">{name}</span>
    </span>
  )
}

function draftCallbackUri(type: ProviderType, providerId: string, callbackBaseUri: string): string {
  if (!providerId) return ''
  const path = type === 'oidc' ? '/api/auth/oauth2/callback' : '/api/auth/callback'
  return `${callbackBaseUri.replace(/\/$/, '')}${path}/${providerId}`
}

export function OAuthProvidersSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { copy } = useClipboard()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingCallbackUri, setEditingCallbackUri] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data, isLoading } = useQuery({
    queryKey: providersQueryKey,
    queryFn: listAuthProviders,
  })

  const upsertMutation = useMutation({
    mutationFn: () => {
      return upsertAuthProvider(form.providerId, {
        type: form.type,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        enabled: form.enabled,
        ...(form.type === 'oidc'
          ? {
              discoveryUrl: form.discoveryUrl,
              scopes: form.scopes
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providersQueryKey })
      toast.success(t('admin.auth.providerSaved'))
      setDrawerOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAuthProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: providersQueryKey })
      toast.success(t('admin.auth.providerDeleted'))
      setDeleteDialogOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const openAdd = () => {
    setForm(emptyForm)
    setEditingId(null)
    setEditingCallbackUri(null)
    setDrawerOpen(true)
  }

  const openEdit = (p: AuthProvider) => {
    setForm({
      type: p.type as ProviderType,
      providerId: p.providerId,
      clientId: p.clientId,
      clientSecret: p.clientSecret ?? '',
      enabled: p.enabled,
      discoveryUrl: p.discoveryUrl ?? '',
      scopes: p.scopes?.join(', ') ?? '',
    })
    setEditingId(p.providerId)
    setEditingCallbackUri(p.callbackUri)
    setDrawerOpen(true)
  }

  const openDelete = (providerId: string) => {
    setDeletingId(providerId)
    setDeleteDialogOpen(true)
  }

  const providers = data?.items ?? []
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }))
  const callbackBaseUri = data?.callbackBaseUri
  const callbackUri = form.providerId
    ? (editingCallbackUri ?? (callbackBaseUri ? draftCallbackUri(form.type, form.providerId, callbackBaseUri) : ''))
    : ''

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.auth.title')}
        description={t('admin.auth.description')}
        action={
          <Button size="sm" onClick={openAdd} disabled={isLoading}>
            <Plus className="mr-2 h-4 w-4" />
            {t('admin.auth.addProvider')}
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : providers.length === 0 ? (
        <div className="rounded-md border px-4 py-12 text-center text-muted-foreground">
          <p className="text-sm">{t('admin.auth.noProviders')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="border-b bg-muted/50">
                <TableHead className="px-4 py-3">{t('admin.auth.provider')}</TableHead>
                <TableHead className="px-4 py-3">{t('admin.auth.providerType')}</TableHead>
                <TableHead className="px-4 py-3">{t('admin.auth.clientId')}</TableHead>
                <TableHead className="px-4 py-3">{t('admin.auth.enabled')}</TableHead>
                <TableHead className="px-4 py-3 text-right">{t('admin.auth.colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => (
                <TableRow key={p.providerId} className="border-b last:border-0 hover:bg-muted/30">
                  <TableCell className="px-4 py-3 font-medium">
                    <ProviderLabel providerId={p.providerId} />
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm">{p.type}</TableCell>
                  <TableCell className="px-4 py-3 text-sm font-mono">{p.clientId}</TableCell>
                  <TableCell className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${p.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}
                    >
                      {p.enabled ? t('admin.auth.statusEnabled') : t('admin.auth.statusDisabled')}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {t('common.edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openDelete(p.providerId)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('common.delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminFormDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editingId ? t('admin.auth.editProviderTitle') : t('admin.auth.addProviderTitle')}
        description={t('admin.auth.providerDrawerDescription')}
        width="wide"
        bodyClassName="grid auto-rows-min content-start gap-4"
        formProps={{
          onSubmit: (event) => {
            event.preventDefault()
            upsertMutation.mutate()
          },
        }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDrawerOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={upsertMutation.isPending || !form.providerId || !form.clientId || !form.clientSecret}
            >
              {upsertMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          <AdminFormLabel htmlFor="oauth-provider-type" required>
            {t('admin.auth.providerType')}
          </AdminFormLabel>
          <ToggleGroup
            id="oauth-provider-type"
            type="single"
            value={form.type}
            variant="outline"
            disabled={!!editingId}
            onValueChange={(value) => value && update({ type: value as ProviderType, providerId: '' })}
            className="w-full"
          >
            <ToggleGroupItem value="builtin" className="flex-1">
              {t('admin.auth.providerBuiltin')}
            </ToggleGroupItem>
            <ToggleGroupItem value="oidc" className="flex-1">
              {t('admin.auth.providerOidc')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {form.type === 'builtin' ? (
          <AdminFormField id="oauth-provider-id" label={t('admin.auth.provider')} required>
            {(controlProps) => (
              <Select value={form.providerId} onValueChange={(v) => update({ providerId: v })} disabled={!!editingId}>
                <SelectTrigger {...controlProps}>
                  <SelectValue placeholder={t('admin.auth.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {BUILTIN_PROVIDER_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      <ProviderLabel providerId={id} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </AdminFormField>
        ) : (
          <AdminFormField
            id="oauth-provider-id"
            label={t('admin.auth.providerId')}
            help={t('admin.auth.providerIdHint')}
            required
          >
            <Input
              value={form.providerId}
              onChange={(e) => update({ providerId: e.target.value })}
              placeholder={t('admin.auth.providerIdPlaceholder')}
              disabled={!!editingId}
            />
          </AdminFormField>
        )}

        <AdminFormField id="oauth-client-id" label={t('admin.auth.clientId')} required>
          <Input
            value={form.clientId}
            onChange={(e) => update({ clientId: e.target.value })}
            placeholder={t('admin.auth.clientIdPlaceholder')}
          />
        </AdminFormField>

        <AdminFormField id="oauth-client-secret" label={t('admin.auth.clientSecret')} required>
          <Input
            type="password"
            value={form.clientSecret}
            onChange={(e) => update({ clientSecret: e.target.value })}
            placeholder={t('admin.auth.clientSecretPlaceholder')}
          />
        </AdminFormField>

        {callbackUri && (
          <AdminFormField
            id="oauth-callback-uri"
            label={t('admin.auth.callbackUri')}
            help={t('admin.auth.callbackUriHint')}
          >
            {(controlProps) => (
              <div className="flex items-center gap-2">
                <Input {...controlProps} value={callbackUri} readOnly className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('admin.auth.copyCallbackUri')}
                  onClick={() => copy(callbackUri, 'admin.auth.callbackUriCopied')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
          </AdminFormField>
        )}

        {form.type === 'oidc' && (
          <>
            <AdminFormField id="oauth-discovery-url" label={t('admin.auth.discoveryUrl')}>
              <Input
                value={form.discoveryUrl}
                onChange={(e) => update({ discoveryUrl: e.target.value })}
                placeholder={t('admin.auth.discoveryUrlPlaceholder')}
              />
            </AdminFormField>
            <AdminFormField id="oauth-scopes" label={t('admin.auth.scopes')} help={t('admin.auth.scopesHint')}>
              <Input
                value={form.scopes}
                onChange={(e) => update({ scopes: e.target.value })}
                placeholder={t('admin.auth.scopesPlaceholder')}
              />
            </AdminFormField>
          </>
        )}

        <div className="flex items-center justify-between gap-4">
          <AdminFormLabel htmlFor="oauth-provider-enabled">{t('admin.auth.enabled')}</AdminFormLabel>
          <Switch
            id="oauth-provider-enabled"
            checked={form.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
        </div>

        <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          {t('admin.auth.runtimeRestartNote')}
        </p>
      </AdminFormDrawer>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.auth.deleteProviderTitle')}</DialogTitle>
            <DialogDescription>
              {t('admin.auth.deleteProviderConfirm', { name: deletingId ? providerName(deletingId) : '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate(deletingId!)}
              disabled={deleteMutation.isPending || !deletingId}
            >
              {deleteMutation.isPending ? t('common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
