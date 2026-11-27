import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  createIhostApiKey,
  createRemoteDownloadApiKey,
  createStremThruApiKey,
  createWebDavAppPassword,
  type IhostApiKey,
  listApiKeys,
  revokeIhostApiKey,
  revokeRemoteDownloadApiKey,
  revokeStremThruApiKey,
  revokeWebDavAppPassword,
} from '@/lib/api'
import { useListOrganizations, useSession } from '@/lib/auth-client'
import { mediaFusionToken } from '@/lib/stremthru'

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  component: ApiKeysSettingsPage,
})

type ApiKeyKind = 'ihost' | 'webdav' | 'remote-download' | 'stremthru'

const API_KEY_KINDS: ApiKeyKind[] = ['ihost', 'webdav', 'remote-download', 'stremthru']

interface ApiKeyRow {
  id: string
  name: string
  kind: ApiKeyKind
  key: IhostApiKey
}

export interface CreatedKey {
  name: string
  key: string
  kind: ApiKeyKind
}

interface Organization {
  id: string
  name: string
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : null
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()

  async function copy() {
    await navigator.clipboard.writeText(value)
    toast.success(t('settings.apiKeys.copied'))
  }

  return (
    <Button type="button" size="icon" variant="ghost" onClick={copy} aria-label={t('settings.apiKeys.copy')}>
      <Copy className="size-4" />
      <span className="sr-only">{t('settings.apiKeys.copy')}</span>
    </Button>
  )
}

function createApiKeyFormSchema(t: (key: string) => string) {
  return z
    .object({
      kind: z.enum(['ihost', 'webdav', 'remote-download', 'stremthru']),
      name: z.string().trim().min(1, t('settings.apiKeys.nameRequired')),
      orgId: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.kind !== 'webdav' && !values.orgId) {
        ctx.addIssue({ code: 'custom', path: ['orgId'], message: t('settings.apiKeys.orgRequired') })
      }
    })
}

type CreateApiKeyFormValues = z.infer<ReturnType<typeof createApiKeyFormSchema>>

const EMPTY_CREATE_API_KEY_FORM: CreateApiKeyFormValues = { kind: 'ihost', name: '', orgId: '' }

export function CreateApiKeyDialog({
  open,
  organizations,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  organizations: Organization[]
  onOpenChange: (open: boolean) => void
  onCreated: (key: CreatedKey) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<CreateApiKeyFormValues>({
    resolver: zodResolver(createApiKeyFormSchema(t)),
    defaultValues: EMPTY_CREATE_API_KEY_FORM,
  })
  const kind = form.watch('kind')
  const orgId = form.watch('orgId')
  const nameError = form.formState.errors.name?.message
  const orgError = form.formState.errors.orgId?.message

  const createMutation = useMutation({
    mutationFn: async (values: CreateApiKeyFormValues) => {
      if (values.kind === 'webdav') {
        return createWebDavAppPassword(values.name)
      }
      if (values.kind === 'ihost') {
        return createIhostApiKey(values.orgId, values.name)
      }
      if (values.kind === 'stremthru') {
        return createStremThruApiKey(values.orgId, values.name)
      }
      return createRemoteDownloadApiKey(values.orgId, values.name)
    },
    onSuccess: (result, values) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      onCreated({ name: result.name ?? values.name, key: result.key, kind: values.kind })
      handleOpenChange(false)
      toast.success(t('settings.apiKeys.createSuccess'))
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      form.reset(EMPTY_CREATE_API_KEY_FORM)
      createMutation.reset()
    }
  }

  const needsOrg = kind !== 'webdav'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.apiKeys.createTitle')}</DialogTitle>
          <DialogDescription>{t('settings.apiKeys.createDescription')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} noValidate>
          <div className="space-y-2">
            <Label htmlFor="api-key-kind">{t('settings.apiKeys.typeLabel')}</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                form.setValue('kind', value as ApiKeyKind, { shouldDirty: true })
                if (form.formState.isSubmitted) void form.trigger('orgId')
              }}
            >
              <SelectTrigger id="api-key-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ihost">{t('settings.apiKeys.typeIhost')}</SelectItem>
                <SelectItem value="webdav">{t('settings.apiKeys.typeWebdav')}</SelectItem>
                <SelectItem value="remote-download">{t('settings.apiKeys.typeRemoteDownload')}</SelectItem>
                <SelectItem value="stremthru">{t('settings.apiKeys.typeStremThru')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-name">{t('settings.apiKeys.nameLabel')}</Label>
            <Input
              id="api-key-name"
              {...form.register('name')}
              placeholder={t('settings.apiKeys.namePlaceholder')}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'api-key-name-error' : undefined}
              aria-required
            />
            {nameError && (
              <p id="api-key-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>
          {needsOrg ? (
            <div className="space-y-2">
              <Label htmlFor="api-key-workspace">{t('settings.apiKeys.scopeLabel')}</Label>
              <Select
                value={orgId}
                onValueChange={(value) => form.setValue('orgId', value, { shouldDirty: true, shouldValidate: true })}
              >
                <SelectTrigger
                  id="api-key-workspace"
                  className="w-full"
                  aria-invalid={orgError ? true : undefined}
                  aria-describedby={orgError ? 'api-key-workspace-error' : undefined}
                  aria-required
                >
                  <SelectValue placeholder={t('settings.apiKeys.scopePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {orgError && (
                <p id="api-key-workspace-error" className="text-xs text-destructive">
                  {orgError}
                </p>
              )}
            </div>
          ) : null}
          {createMutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {createMutation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !form.formState.isDirty}>
              <Plus className="size-4" />
              {createMutation.isPending ? t('common.loading') : t('settings.apiKeys.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreatedKeyDialog({ createdKey, onClose }: { createdKey: CreatedKey | null; onClose: () => void }) {
  const { t } = useTranslation()

  if (!createdKey) return null
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const token = createdKey.kind === 'stremthru' ? mediaFusionToken(origin, createdKey.key) : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.apiKeys.createdTitle')}</DialogTitle>
          <DialogDescription>{t('settings.apiKeys.createdWarning')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{createdKey.name}</Label>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
            <code className="min-w-0 flex-1 break-all text-sm">{createdKey.key}</code>
            <CopyButton value={createdKey.key} />
          </div>
        </div>
        {token ? (
          <div className="space-y-2">
            <Label>{t('settings.apiKeys.mediaFusionToken')}</Label>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 break-all text-sm" data-testid="mediafusion-token">
                {token}
              </code>
              <CopyButton value={token} />
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.apiKeys.mediaFusionTokenHint')}</p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeApiKeyDialog({ apiKey, onClose }: { apiKey: ApiKeyRow | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!apiKey) return
      if (apiKey.kind === 'webdav') {
        await revokeWebDavAppPassword(apiKey.id)
        return
      }
      if (apiKey.kind === 'ihost') {
        await revokeIhostApiKey(apiKey.id)
        return
      }
      if (apiKey.kind === 'stremthru') {
        await revokeStremThruApiKey(apiKey.id)
        return
      }
      await revokeRemoteDownloadApiKey(apiKey.id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success(t('settings.apiKeys.revokeSuccess'))
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  if (!apiKey) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.apiKeys.revokeTitle')}</DialogTitle>
          <DialogDescription>{t('settings.apiKeys.revokeConfirm', { name: apiKey.name })}</DialogDescription>
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
            {revokeMutation.isPending ? t('common.loading') : t('settings.apiKeys.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApiKeysSettingsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: organizationData } = useListOrganizations()
  const organizations = (organizationData ?? []) as Organization[]
  const [createOpen, setCreateOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null)

  const apiKeysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: listApiKeys,
    enabled: !!session,
  })

  const rows: ApiKeyRow[] = (apiKeysQuery.data ?? [])
    .filter((key): key is IhostApiKey & { configId: ApiKeyKind } => API_KEY_KINDS.includes(key.configId as ApiKeyKind))
    .map((key) => ({ id: key.id, name: key.name ?? key.id, kind: key.configId, key }))
    .sort((a, b) => new Date(b.key.createdAt).getTime() - new Date(a.key.createdAt).getTime())

  const orgNames = new Map(organizations.map((org) => [org.id, org.name]))
  const isLoading = apiKeysQuery.isLoading

  function scopeLabel(row: ApiKeyRow): string {
    const scope = row.key.metadata?.scope
    if (scope?.mode === 'user-workspaces') return t('settings.apiKeys.scopeAllWorkspaces')
    if (scope?.mode === 'workspace')
      return orgNames.get(scope.orgId) ?? t('settings.apiKeys.scopeUnavailable', { orgId: scope.orgId })
    return t('settings.apiKeys.scopeInvalid')
  }

  return (
    <div className="max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.apiKeys.section')}</CardTitle>
          <CardDescription>{t('settings.apiKeys.description')}</CardDescription>
          <CardAction>
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('settings.apiKeys.create')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.apiKeys.noKeys')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.apiKeys.colName')}</TableHead>
                  <TableHead>{t('settings.apiKeys.colType')}</TableHead>
                  <TableHead>{t('settings.apiKeys.colScope')}</TableHead>
                  <TableHead>{t('settings.apiKeys.colCreated')}</TableHead>
                  <TableHead>{t('settings.apiKeys.colLastUsed')}</TableHead>
                  <TableHead className="w-20 text-right">{t('settings.apiKeys.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.kind}:${row.id}`}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      {row.key.start ? <div className="text-xs text-muted-foreground">{row.key.start}</div> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t(`settings.apiKeys.type.${row.kind}`)}</Badge>
                    </TableCell>
                    <TableCell>{scopeLabel(row)}</TableCell>
                    <TableCell>{formatDate(row.key.createdAt)}</TableCell>
                    <TableCell>{formatDate(row.key.lastRequest) ?? t('settings.apiKeys.never')}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setRevoking(row)}
                        aria-label={t('settings.apiKeys.revoke')}
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">{t('settings.apiKeys.revoke')}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateApiKeyDialog
        open={createOpen}
        organizations={organizations}
        onOpenChange={setCreateOpen}
        onCreated={(key) => setCreatedKey(key)}
      />
      <CreatedKeyDialog createdKey={createdKey} onClose={() => setCreatedKey(null)} />
      <RevokeApiKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}
