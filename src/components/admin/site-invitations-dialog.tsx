import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Loader2, MailPlus, RotateCw, ShieldX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useClipboard } from '@/hooks/use-clipboard'
import {
  type ApiError,
  createSiteInvitation,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
} from '@/lib/api'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

interface SiteInvitationsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const pageSize = 20

function buildInviteLink(token: string): string {
  return `${window.location.origin}/sign-up?invite=${encodeURIComponent(token)}`
}

function StatusBadge({ status }: { status: 'pending' | 'accepted' | 'expired' | 'revoked' }) {
  const { t } = useTranslation()
  const className =
    status === 'accepted'
      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
      : status === 'pending'
        ? 'bg-primary/10 text-primary'
        : status === 'expired'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground'

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {t(`admin.users.inviteStatus.${status}`)}
    </span>
  )
}

export function SiteInvitationsDialog({ open, onOpenChange }: SiteInvitationsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { copy } = useClipboard()
  const [email, setEmail] = useState('')
  const [page, setPage] = useState(1)

  const invitationsQuery = useQuery({
    queryKey: ['admin', 'site-invitations', page, pageSize],
    queryFn: () => listSiteInvitations(page, pageSize),
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: (nextEmail: string) => createSiteInvitation(nextEmail),
    onSuccess: () => {
      setEmail('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteCreated'))
    },
    onError: (error: ApiError | Error) => {
      toast.error(error.message)
    },
  })

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendSiteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteResent'))
    },
    onError: (error: ApiError | Error) => {
      toast.error(error.message)
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeSiteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteRevoked'))
    },
    onError: (error: ApiError | Error) => {
      toast.error(error.message)
    },
  })

  const items = invitationsQuery.data?.items ?? []
  const total = invitationsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isBusy = createMutation.isPending || resendMutation.isPending || revokeMutation.isPending

  const pendingCount = useMemo(() => items.filter((item) => item.status === 'pending').length, [items])

  async function handleCopy(token: string) {
    try {
      await copy(buildInviteLink(token), 'admin.users.inviteLinkCopied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    createMutation.mutate(email.trim())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) {
          setEmail('')
          setPage(1)
        }
      }}
    >
      <DialogContent className="flex max-h-[min(760px,calc(100vh-2rem))] flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{t('admin.users.inviteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('admin.users.inviteDialogDescription', { count: pendingCount })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 overflow-y-auto px-6 py-5">
          <form
            onSubmit={handleSubmit}
            className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto] md:items-end"
          >
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('admin.users.inviteEmail')}</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('admin.users.inviteEmailPlaceholder')}
                required
              />
            </div>
            <Button type="submit" disabled={createMutation.isPending || !email.trim()}>
              {createMutation.isPending ? <Loader2 className="animate-spin" /> : <MailPlus />}
              {t('admin.users.sendInvite')}
            </Button>
          </form>

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">{t('admin.users.inviteColEmail')}</th>
                  <th className="px-4 py-3 text-left font-medium">{t('admin.users.inviteColStatus')}</th>
                  <th className="hidden px-4 py-3 text-left font-medium md:table-cell">
                    {t('admin.users.inviteColInvitedBy')}
                  </th>
                  <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                    {t('admin.users.inviteColCreatedAt')}
                  </th>
                  <th className="hidden px-4 py-3 text-left font-medium lg:table-cell">
                    {t('admin.users.inviteColExpiresAt')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">{t('admin.users.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {invitationsQuery.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {t('common.loading')}
                    </td>
                  </tr>
                )}

                {!invitationsQuery.isLoading &&
                  items.map((invitation) => {
                    const actionsDisabled = isBusy && resendMutation.variables !== invitation.id
                    return (
                      <tr key={invitation.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{invitation.email}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={invitation.status} />
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {invitation.invitedByName}
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                          {formatDate(invitation.createdAt)}
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                          {formatDate(invitation.expiresAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleCopy(invitation.token)}
                              title={t('admin.users.copyInviteLink')}
                            >
                              <ClipboardCopy />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={invitation.status !== 'pending' || actionsDisabled}
                              onClick={() => resendMutation.mutate(invitation.id)}
                              title={t('admin.users.resendInvite')}
                            >
                              <RotateCw
                                className={
                                  resendMutation.isPending && resendMutation.variables === invitation.id
                                    ? 'animate-spin'
                                    : ''
                                }
                              />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              disabled={invitation.status !== 'pending' || actionsDisabled}
                              onClick={() => revokeMutation.mutate(invitation.id)}
                              title={t('admin.users.revokeInvite')}
                            >
                              <ShieldX className="text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                {!invitationsQuery.isLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {t('admin.users.noInvitations')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {t('admin.users.pageInfo', { page, total: totalPages })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('admin.users.prevPage')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('admin.users.nextPage')}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
