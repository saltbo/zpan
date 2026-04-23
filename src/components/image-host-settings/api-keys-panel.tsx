import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { type CreateIhostApiKeyResult, createIhostApiKey, listIhostApiKeys, revokeIhostApiKey } from '@/lib/api'

const ihostApiKeysQueryKey = (orgId: string) => ['ihost', 'api-keys', orgId] as const

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString()
}

interface NewKeyDialogProps {
  result: CreateIhostApiKeyResult
  onClose: () => void
}

function NewKeyDialog({ result, onClose }: NewKeyDialogProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(result.key).then(
      () => {
        setCopied(true)
        toast.success(t('settings.ihost.apiKeys.keyCopied'))
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error(t('common.error')),
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.ihost.apiKeys.newKeyTitle')}</DialogTitle>
          <DialogDescription>{t('settings.ihost.apiKeys.newKeyWarning')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 font-mono text-sm break-all select-all">{result.key}</div>
          <Button variant="outline" size="sm" onClick={handleCopy} className="w-full">
            {copied ? t('settings.ihost.customDomain.copied') : t('settings.ihost.apiKeys.copyKey')}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface RevokeDialogProps {
  keyId: string
  keyName: string | null
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function RevokeDialog({ keyId, keyName, onConfirm, onCancel, isPending }: RevokeDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.ihost.apiKeys.revokeTitle')}</DialogTitle>
          <DialogDescription>{t('settings.ihost.apiKeys.revokeConfirm', { name: keyName ?? keyId })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? t('common.loading') : t('settings.ihost.apiKeys.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ApiKeysPanelProps {
  orgId: string
}

export function ApiKeysPanel({ orgId }: ApiKeysPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newKey, setNewKey] = useState<CreateIhostApiKeyResult | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string | null } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<{ name: string }>()

  const keysQuery = useQuery({
    queryKey: ihostApiKeysQueryKey(orgId),
    queryFn: () => listIhostApiKeys(orgId),
  })

  const createMutation = useMutation({
    mutationFn: ({ name }: { name: string }) => createIhostApiKey(orgId, name),
    onSuccess: (result) => {
      setCreateOpen(false)
      reset()
      setNewKey(result)
      toast.success(t('settings.ihost.apiKeys.createdSuccess'))
      queryClient.invalidateQueries({ queryKey: ihostApiKeysQueryKey(orgId) })
    },
    onError: (err) => toast.error(err.message),
  })

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokeIhostApiKey(keyId),
    onSuccess: () => {
      setRevokeTarget(null)
      toast.success(t('settings.ihost.apiKeys.revokeSuccess'))
      queryClient.invalidateQueries({ queryKey: ihostApiKeysQueryKey(orgId) })
    },
    onError: (err) => toast.error(err.message),
  })

  const keys = keysQuery.data ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.ihost.apiKeys.section')}</CardTitle>
          <CardDescription>{t('settings.ihost.apiKeys.description')}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t('settings.ihost.apiKeys.create')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {keys.length === 0 && !keysQuery.isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('settings.ihost.apiKeys.noKeys')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.ihost.apiKeys.colName')}</TableHead>
                  <TableHead>{t('settings.ihost.apiKeys.colCreated')}</TableHead>
                  <TableHead>{t('settings.ihost.apiKeys.colLastUsed')}</TableHead>
                  <TableHead>{t('settings.ihost.apiKeys.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div className="font-medium">{key.name ?? key.id}</div>
                      {key.start && <div className="font-mono text-xs text-muted-foreground">{key.start}…</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {key.lastRequest ? formatDate(key.lastRequest) : t('settings.ihost.apiKeys.never')}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setRevokeTarget({ id: key.id, name: key.name })}
                      >
                        {t('settings.ihost.apiKeys.revoke')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create API Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.ihost.apiKeys.createTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="keyName">{t('settings.ihost.apiKeys.nameLabel')}</Label>
              <Input
                id="keyName"
                placeholder={t('settings.ihost.apiKeys.namePlaceholder')}
                {...register('name', { required: true, maxLength: 50 })}
              />
              {errors.name && <p className="text-xs text-destructive">{t('common.error')}</p>}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false)
                  reset()
                }}
                disabled={createMutation.isPending}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? t('common.loading') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Key Display Dialog */}
      {newKey && <NewKeyDialog result={newKey} onClose={() => setNewKey(null)} />}

      {/* Revoke Confirmation Dialog */}
      {revokeTarget && (
        <RevokeDialog
          keyId={revokeTarget.id}
          keyName={revokeTarget.name}
          onConfirm={() => revokeMutation.mutate(revokeTarget.id)}
          onCancel={() => setRevokeTarget(null)}
          isPending={revokeMutation.isPending}
        />
      )}
    </>
  )
}
