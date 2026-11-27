import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ClipboardCopy, RotateCw, ShieldX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmActionDialog } from '@/components/admin/confirm-action-dialog'
import { CursorPagination } from '@/components/list/cursor-pagination'
import { useClipboard } from '@/hooks/use-clipboard'
import { useCursorPager, useStepBackFromEmptyPage } from '@/hooks/use-cursor-pager'
import { type ApiError, listSiteInvitations, resendSiteInvitation, revokeSiteInvitation } from '@/lib/api'
import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'

const PAGE_SIZE_OPTIONS = [20, 50, 100]

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

export function SiteInvitationsList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { copy } = useClipboard()
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0])
  const pager = useCursorPager(String(pageSize))
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; email: string } | null>(null)

  const invitationsQuery = useQuery({
    queryKey: ['admin', 'site-invitations', pageSize, pager.pageToken],
    queryFn: () => listSiteInvitations({ pageToken: pager.pageToken, pageSize }),
    placeholderData: keepPreviousData,
  })
  useStepBackFromEmptyPage(pager, invitationsQuery)

  const resendMutation = useMutation({
    mutationFn: (id: string) => resendSiteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteResent'))
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeSiteInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'site-invitations'] })
      toast.success(t('admin.users.inviteRevoked'))
      setPendingRevoke(null)
    },
    onError: (error: ApiError | Error) => {
      toast.error(error.message)
    },
  })

  const items = invitationsQuery.data?.items ?? []
  const isBusy = resendMutation.isPending || revokeMutation.isPending
  // A failed resend stays above the table, where it was asked for. The server writes the message.
  const resendError = resendMutation.error?.message

  async function handleCopy(token: string) {
    try {
      await copy(buildInviteLink(token), 'admin.users.inviteLinkCopied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    }
  }

  return (
    <div className="space-y-4">
      {resendError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{resendError}</AlertDescription>
        </Alert>
      )}

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
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{invitation.invitedByName}</td>
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
                          aria-label={t('admin.users.copyInviteLink')}
                        >
                          <ClipboardCopy />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          disabled={invitation.status !== 'pending' || actionsDisabled}
                          onClick={() => resendMutation.mutate(invitation.id)}
                          title={t('admin.users.resendInvite')}
                          aria-label={t('admin.users.resendInvite')}
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
                          onClick={() => setPendingRevoke({ id: invitation.id, email: invitation.email })}
                          title={t('admin.users.revokeInvite')}
                          aria-label={t('admin.users.revokeInvite')}
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

      <CursorPagination
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        hasPrevious={pager.hasPrevious}
        nextPageToken={invitationsQuery.data?.nextPageToken}
        disabled={invitationsQuery.isFetching}
        onPageSizeChange={setPageSize}
        onPrevious={pager.previous}
        onNext={pager.next}
      />

      <ConfirmActionDialog
        open={pendingRevoke !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingRevoke(null)
        }}
        title={t('admin.users.revokeInviteTitle')}
        description={t('admin.users.revokeInviteConfirm', { email: pendingRevoke?.email ?? '' })}
        confirmLabel={t('admin.users.revokeInvite')}
        isPending={revokeMutation.isPending}
        onConfirm={() => {
          if (pendingRevoke) revokeMutation.mutate(pendingRevoke.id)
        }}
      />
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}
