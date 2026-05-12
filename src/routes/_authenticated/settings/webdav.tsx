import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type CreateWebDavAppPasswordResult,
  createWebDavAppPassword,
  listWebDavAppPasswords,
  revokeWebDavAppPassword,
  type WebDavAppPassword,
} from '@/lib/api'
import { useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/webdav')({
  component: WebDavSettingsPage,
})

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    toast.success(t('settings.webdav.copied'))
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button type="button" size="icon" variant="ghost" onClick={copy} aria-label={t('settings.webdav.copy')}>
      <Copy className="size-4" />
      <span className="sr-only">{copied ? t('settings.webdav.copied') : t('settings.webdav.copy')}</span>
    </Button>
  )
}

function NewPasswordDialog({
  password,
  onClose,
}: {
  password: CreateWebDavAppPasswordResult | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!password) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.webdav.newPasswordTitle')}</DialogTitle>
          <DialogDescription>{t('settings.webdav.newPasswordWarning')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 break-all text-sm">{password.key}</code>
          <CopyButton value={password.key} />
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

function RevokeDialog({ password, onClose }: { password: WebDavAppPassword | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: revokeWebDavAppPassword,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webdav', 'app-passwords'] })
      toast.success(t('settings.webdav.revokeSuccess'))
      onClose()
    },
    onError: (err) => toast.error(err.message),
  })

  if (!password) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.webdav.revokeTitle')}</DialogTitle>
          <DialogDescription>
            {t('settings.webdav.revokeConfirm', { name: password.name ?? password.id })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(password.id)}
          >
            {mutation.isPending ? t('common.loading') : t('settings.webdav.revoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WebDavSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState<CreateWebDavAppPasswordResult | null>(null)
  const [revoking, setRevoking] = useState<WebDavAppPassword | null>(null)

  const passwordsQuery = useQuery({
    queryKey: ['webdav', 'app-passwords'],
    queryFn: listWebDavAppPasswords,
    enabled: !!session,
  })

  const createMutation = useMutation({
    mutationFn: createWebDavAppPassword,
    onSuccess: (password) => {
      queryClient.invalidateQueries({ queryKey: ['webdav', 'app-passwords'] })
      setName('')
      setNewPassword(password)
      toast.success(t('settings.webdav.createSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const webDavUrl = `${origin}/dav/`
  const user = session?.user as { email?: string; username?: string } | undefined
  const username = user?.email ?? user?.username ?? ''
  const passwords = passwordsQuery.data ?? []

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.webdav.connection.section')}</CardTitle>
          <CardDescription>{t('settings.webdav.connection.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
            <Label>{t('settings.webdav.url')}</Label>
            <code className="min-w-0 break-all rounded-md bg-muted px-3 py-2 text-sm">{webDavUrl}</code>
            <CopyButton value={webDavUrl} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
            <Label>{t('settings.webdav.username')}</Label>
            <code className="min-w-0 break-all rounded-md bg-muted px-3 py-2 text-sm">{username}</code>
            <CopyButton value={username} />
          </div>
          <p className="text-sm text-muted-foreground">{t('settings.webdav.instructions')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t('settings.webdav.passwords.section')}</CardTitle>
              <CardDescription>{t('settings.webdav.passwords.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.webdav.passwords.namePlaceholder')}
            />
            <Button
              type="button"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(name.trim())}
            >
              <Plus className="size-4" />
              {createMutation.isPending ? t('common.loading') : t('settings.webdav.passwords.create')}
            </Button>
          </div>

          {passwords.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('settings.webdav.passwords.noPasswords')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.webdav.passwords.colName')}</TableHead>
                  <TableHead>{t('settings.webdav.passwords.colCreated')}</TableHead>
                  <TableHead>{t('settings.webdav.passwords.colLastUsed')}</TableHead>
                  <TableHead className="w-20 text-right">{t('settings.webdav.passwords.colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {passwords.map((password) => (
                  <TableRow key={password.id}>
                    <TableCell>{password.name ?? password.id}</TableCell>
                    <TableCell>{formatDate(password.createdAt)}</TableCell>
                    <TableCell>
                      {password.lastRequest ? formatDate(password.lastRequest) : t('settings.webdav.passwords.never')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setRevoking(password)}
                        aria-label={t('settings.webdav.revoke')}
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
      </Card>

      <NewPasswordDialog password={newPassword} onClose={() => setNewPassword(null)} />
      <RevokeDialog password={revoking} onClose={() => setRevoking(null)} />
    </div>
  )
}
