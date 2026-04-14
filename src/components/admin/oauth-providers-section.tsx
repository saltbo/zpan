import { BUILTIN_PROVIDER_IDS, type OAuthProviderConfig, OAuthProviderMeta } from '@shared/oauth-providers'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { deleteAuthProvider, listAdminAuthProviders, upsertAuthProvider } from '@/lib/api'

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

export function OAuthProvidersSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data, isLoading } = useQuery({
    queryKey: providersQueryKey,
    queryFn: listAdminAuthProviders,
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
      setDialogOpen(false)
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
    setDialogOpen(true)
  }

  const openEdit = (p: OAuthProviderConfig) => {
    setForm({
      type: p.type,
      providerId: p.providerId,
      clientId: p.clientId,
      clientSecret: p.clientSecret,
      enabled: p.enabled,
      discoveryUrl: p.discoveryUrl ?? '',
      scopes: p.scopes?.join(', ') ?? '',
    })
    setEditingId(p.providerId)
    setDialogOpen(true)
  }

  const openDelete = (providerId: string) => {
    setDeletingId(providerId)
    setDeleteDialogOpen(true)
  }

  const providers = data?.items ?? []
  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }))

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.oauthSection')}</h3>
        <Button size="sm" onClick={openAdd}>
          {t('admin.auth.addProvider')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.auth.noProviders')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.auth.provider')}</TableHead>
              <TableHead>{t('admin.auth.providerType')}</TableHead>
              <TableHead>{t('admin.auth.clientId')}</TableHead>
              <TableHead>{t('admin.auth.enabled')}</TableHead>
              <TableHead>{t('admin.auth.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.providerId}>
                <TableCell className="font-medium">{providerName(p.providerId)}</TableCell>
                <TableCell className="text-sm">{p.type}</TableCell>
                <TableCell className="text-sm font-mono">{p.clientId}</TableCell>
                <TableCell>
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${p.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                  >
                    {p.enabled ? t('admin.auth.statusEnabled') : t('admin.auth.statusDisabled')}
                  </span>
                </TableCell>
                <TableCell className="space-x-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openDelete(p.providerId)}>
                    {t('common.delete')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('admin.auth.editProviderTitle') : t('admin.auth.addProviderTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('admin.auth.providerType')}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => update({ type: v as ProviderType, providerId: '' })}
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="builtin">{t('admin.auth.providerBuiltin')}</SelectItem>
                  <SelectItem value="oidc">{t('admin.auth.providerOidc')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.type === 'builtin' ? (
              <div className="space-y-1.5">
                <Label>{t('admin.auth.provider')}</Label>
                <Select value={form.providerId} onValueChange={(v) => update({ providerId: v })} disabled={!!editingId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN_PROVIDER_IDS.map((id) => (
                      <SelectItem key={id} value={id}>
                        {OAuthProviderMeta[id]?.name ?? id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t('admin.auth.providerId')}</Label>
                <Input
                  value={form.providerId}
                  onChange={(e) => update({ providerId: e.target.value })}
                  placeholder={t('admin.auth.providerIdHint')}
                  disabled={!!editingId}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t('admin.auth.clientId')}</Label>
              <Input value={form.clientId} onChange={(e) => update({ clientId: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.clientSecret')}</Label>
              <Input
                type="password"
                value={form.clientSecret}
                onChange={(e) => update({ clientSecret: e.target.value })}
              />
            </div>

            {form.type === 'oidc' && (
              <>
                <div className="space-y-1.5">
                  <Label>{t('admin.auth.discoveryUrl')}</Label>
                  <Input value={form.discoveryUrl} onChange={(e) => update({ discoveryUrl: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('admin.auth.scopes')}</Label>
                  <Input
                    value={form.scopes}
                    onChange={(e) => update({ scopes: e.target.value })}
                    placeholder={t('admin.auth.scopesHint')}
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <Checkbox id="providerEnabled" checked={form.enabled} onCheckedChange={(v) => update({ enabled: !!v })} />
              <Label htmlFor="providerEnabled">{t('admin.auth.enabled')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => upsertMutation.mutate()}
              disabled={upsertMutation.isPending || !form.providerId || !form.clientId || !form.clientSecret}
            >
              {upsertMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
