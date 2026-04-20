import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { ClipboardCopy, FileIcon, FolderIcon, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RevokeConfirmDialog } from '@/components/shares/revoke-confirm-dialog'
import { ShareDetailPanel } from '@/components/shares/share-detail-panel'
import { Button } from '@/components/ui/button'
import { deleteShare, listShares, type ShareListItem } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/shares/')({
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter) ?? 'all',
    page: Number(search.page) || 1,
  }),
  component: SharesPage,
})

type StatusFilter = 'all' | 'active' | 'revoked' | 'expired'

const PAGE_SIZE = 20

function getBackendStatus(filter: StatusFilter): 'active' | 'revoked' | undefined {
  if (filter === 'active' || filter === 'expired') return 'active'
  if (filter === 'revoked') return 'revoked'
  return undefined
}

function computeDisplayStatus(share: ShareListItem): 'active' | 'revoked' | 'expired' {
  if (share.status === 'revoked') return 'revoked'
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return 'expired'
  return 'active'
}

function SharesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status: statusFilter, page } = useSearch({ from: '/_authenticated/shares/' })

  const [detailShare, setDetailShare] = useState<ShareListItem | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ShareListItem | null>(null)

  const backendStatus = getBackendStatus(statusFilter)

  const sharesQuery = useQuery({
    queryKey: ['shares', page, PAGE_SIZE, backendStatus],
    queryFn: () => listShares(page, PAGE_SIZE, backendStatus),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => deleteShare(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shares'] })
      toast.success(t('shares.revokeSuccess'))
      setRevokeTarget(null)
    },
    onError: () => {
      toast.error(t('shares.revokeError'))
    },
  })

  const filteredItems = useMemo(() => {
    const items = sharesQuery.data?.items ?? []
    if (statusFilter === 'active') {
      return items.filter((s) => computeDisplayStatus(s) === 'active')
    }
    if (statusFilter === 'expired') {
      return items.filter((s) => computeDisplayStatus(s) === 'expired')
    }
    return items
  }, [sharesQuery.data, statusFilter])

  const total = sharesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function setFilter(filter: StatusFilter) {
    navigate({ to: '/shares', search: { status: filter, page: 1 } })
  }

  function setPage(newPage: number) {
    navigate({ to: '/shares', search: { status: statusFilter, page: newPage } })
  }

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('shares.filterAll') },
    { key: 'active', label: t('shares.filterActive') },
    { key: 'revoked', label: t('shares.filterRevoked') },
    { key: 'expired', label: t('shares.filterExpired') },
  ]

  if (sharesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t('shares.title')}</h2>

      <div className="flex gap-1 border-b pb-0">
        {filterTabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">{t('shares.colFile')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colType')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colRecipients')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colViews')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colDownloads')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colExpires')}</th>
              <th className="px-4 py-3 text-left font-medium">{t('shares.colStatus')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('shares.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((share) => (
              <ShareTableRow
                key={share.id}
                share={share}
                displayStatus={computeDisplayStatus(share)}
                onRowClick={() => setDetailShare(share)}
                onCopyUrl={() => {
                  const base = window.location.origin
                  const url = share.kind === 'landing' ? `${base}/s/${share.token}` : `${base}/dl/${share.token}`
                  navigator.clipboard.writeText(url)
                  toast.success(t('shares.urlCopied'))
                }}
                onRevoke={() => setRevokeTarget(share)}
              />
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <p className="font-medium">{t('shares.emptyState')}</p>
                  <p className="mt-1 text-xs">{t('shares.emptyStateHint')}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('shares.prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground">{t('shares.pageInfo', { page, total: totalPages })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            {t('shares.nextPage')}
          </Button>
        </div>
      )}

      <ShareDetailPanel share={detailShare} onClose={() => setDetailShare(null)} />

      <RevokeConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        filename={revokeTarget?.matter.name ?? ''}
        isPending={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />
    </div>
  )
}

function ShareTableRow({
  share,
  displayStatus,
  onRowClick,
  onCopyUrl,
  onRevoke,
}: {
  share: ShareListItem
  displayStatus: 'active' | 'revoked' | 'expired'
  onRowClick: () => void
  onCopyUrl: () => void
  onRevoke: () => void
}) {
  const { t } = useTranslation()

  const typeChip =
    share.kind === 'landing'
      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
      : 'bg-orange-500/10 text-orange-700 dark:text-orange-400'

  const statusChip = {
    active: 'bg-green-500/10 text-green-700 dark:text-green-400',
    revoked: 'bg-muted text-muted-foreground',
    expired: 'bg-destructive/10 text-destructive',
  }[displayStatus]

  const statusLabel = {
    active: t('shares.statusActive'),
    revoked: t('shares.statusRevoked'),
    expired: t('shares.statusExpired'),
  }[displayStatus]

  const typeLabel = share.kind === 'landing' ? t('shares.typeLanding') : t('shares.typeDirect')

  const recipientsLabel = share.recipientCount > 0 ? String(share.recipientCount) : t('shares.recipientsPublic')

  const downloadsLabel =
    share.downloadLimit != null ? `${share.downloads} / ${share.downloadLimit}` : String(share.downloads)

  const viewsLabel = share.kind === 'direct' ? '—' : String(share.views)

  const expiresLabel = formatExpires(share.expiresAt, t)

  const FileTypeIcon = share.matter.dirtype === 1 ? FolderIcon : FileIcon

  return (
    <tr className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={onRowClick}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileTypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[160px] font-medium" title={share.matter.name}>
            {share.matter.name}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${typeChip}`}>{typeLabel}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{recipientsLabel}</td>
      <td className="px-4 py-3 tabular-nums text-muted-foreground">{viewsLabel}</td>
      <td className="px-4 py-3 tabular-nums text-muted-foreground">{downloadsLabel}</td>
      <td className="px-4 py-3 text-muted-foreground">{expiresLabel}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusChip}`}>{statusLabel}</span>
      </td>
      <td className="px-4 py-3">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stop-propagation wrapper for action buttons */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation wrapper for action buttons */}
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-xs" onClick={onCopyUrl} title={t('shares.copyUrl')}>
            <ClipboardCopy />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={displayStatus !== 'active'}
            onClick={onRevoke}
            title={t('shares.revoke')}
          >
            <XCircle className={displayStatus === 'active' ? 'text-destructive' : ''} />
          </Button>
        </div>
      </td>
    </tr>
  )
}

function formatExpires(expiresAt: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!expiresAt) return t('shares.expiresNever')

  const now = Date.now()
  const exp = new Date(expiresAt).getTime()
  const diffMs = exp - now
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffMs > 0) {
    if (diffDays === 0) return t('shares.expiresInHours')
    return t('shares.expiresInDays', { count: diffDays })
  }

  const pastDays = Math.round(-diffDays)
  if (pastDays === 0) return t('shares.expiredToday')
  return t('shares.expiredDaysAgo', { count: pastDays })
}
