import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  createWebDavAppPassword,
  type IhostApiKey,
  listIhostApiKeys,
  listRemoteDownloadApiKeys,
  listWebDavAppPasswords,
  revokeIhostApiKey,
  revokeRemoteDownloadApiKey,
  revokeWebDavAppPassword,
} from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  component: ApiKeysSettingsPage,
})

type ApiKeyKind = 'ihost' | 'webdav' | 'remote-download'

interface ApiKeyRow {
  id: string
  name: string
  kind: ApiKeyKind
  key: IhostApiKey
}

interface CreatedKey {
  name: string
  key: string
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

function CreateApiKeyDialog({
  open,
  orgId,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  orgId: string | undefined
  onOpenChange: (open: boolean) => void
  onCreated: (key: CreatedKey) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ApiKeyKind>('ihost')
  const [name, setName] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim()
      if (kind === 'webdav') {
        return createWebDavAppPassword(trimmedName)
      }
      if (!orgId) {
        throw new Error(t('settings.apiKeys.orgRequired'))
      }
      if (kind === 'ihost') {
        return createIhostApiKey(orgId, trimmedName)
      }
      return createRemoteDownloadApiKey(orgId, trimmedName)
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      onCreated({ name: result.name ?? name.trim(), key: result.key })
      setName('')
      setKind('ihost')
      onOpenChange(false)
      toast.success(t('settings.apiKeys.createSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const needsOrg = kind !== 'webdav'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.apiKeys.createTitle')}</DialogTitle>
          <DialogDescription>{t('settings.apiKeys.createDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key-kind">{t('settings.apiKeys.typeLabel')}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ApiKeyKind)}>
              <SelectTrigger id="api-key-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ihost">{t('settings.apiKeys.typeIhost')}</SelectItem>
                <SelectItem value="webdav">{t('settings.apiKeys.typeWebdav')}</SelectItem>
                <SelectItem value="remote-download">{t('settings.apiKeys.typeRemoteDownload')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key-name">{t('settings.apiKeys.nameLabel')}</Label>
            <Input
              id="api-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('settings.apiKeys.namePlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || createMutation.isPending || (needsOrg && !orgId)}
            onClick={() => createMutation.mutate()}
          >
            <Plus className="size-4" />
            {createMutation.isPending ? t('common.loading') : t('settings.apiKeys.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreatedKeyDialog({ createdKey, onClose }: { createdKey: CreatedKey | null; onClose: () => void }) {
  const { t } = useTranslation()

  if (!createdKey) return null

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
  const { data: activeOrg } = useActiveOrganization()
  const orgId = activeOrg?.id
  const [createOpen, setCreateOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null)

  const ihostQuery = useQuery({
    queryKey: ['api-keys', 'ihost', orgId],
    queryFn: () => listIhostApiKeys(orgId as string),
    enabled: !!orgId,
  })
  const webdavQuery = useQuery({
    queryKey: ['api-keys', 'webdav'],
    queryFn: listWebDavAppPasswords,
    enabled: !!session,
  })
  const remoteDownloadQuery = useQuery({
    queryKey: ['api-keys', 'remote-download', orgId],
    queryFn: () => listRemoteDownloadApiKeys(orgId as string),
    enabled: !!orgId,
  })

  const rows: ApiKeyRow[] = [
    ...(ihostQuery.data ?? []).map((key) => ({ id: key.id, name: key.name ?? key.id, kind: 'ihost' as const, key })),
    ...(webdavQuery.data ?? []).map((key) => ({
      id: key.id,
      name: key.name ?? key.id,
      kind: 'webdav' as const,
      key,
    })),
    ...(remoteDownloadQuery.data ?? []).map((key) => ({
      id: key.id,
      name: key.name ?? key.id,
      kind: 'remote-download' as const,
      key,
    })),
  ].sort((a, b) => new Date(b.key.createdAt).getTime() - new Date(a.key.createdAt).getTime())

  const isLoading = ihostQuery.isLoading || webdavQuery.isLoading || remoteDownloadQuery.isLoading

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
        orgId={orgId}
        onOpenChange={setCreateOpen}
        onCreated={(key) => setCreatedKey(key)}
      />
      <CreatedKeyDialog createdKey={createdKey} onClose={() => setCreatedKey(null)} />
      <RevokeApiKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}
