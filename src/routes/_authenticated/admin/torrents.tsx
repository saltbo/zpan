import type { AdminTorrent, TorrentCacheSettings } from '@shared/schemas'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ConfirmActionDialog } from '@/components/admin/confirm-action-dialog'
import { TorrentCacheSettingsDrawer } from '@/components/admin/torrent-cache-settings-drawer'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { CursorPagination } from '@/components/list/cursor-pagination'
import { ProBadge } from '@/components/ProBadge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCursorPager } from '@/hooks/use-cursor-pager'
import { useEntitlement } from '@/hooks/useEntitlement'
import { evictCachedTorrent, getTorrentCacheSettings, listCachedTorrents } from '@/lib/api'
import { formatSize } from '@/lib/format'
import { numberOptionParam } from '@/lib/list-search'

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 20

export const adminTorrentsSearchSchema = z.object({
  size: numberOptionParam(PAGE_SIZE_OPTIONS),
})

export const Route = createFileRoute('/_authenticated/admin/torrents')({
  validateSearch: adminTorrentsSearchSchema,
  component: AdminTorrentsPage,
})

const SETTINGS_QUERY_KEY = ['admin', 'torrent-cache-settings']

export function AdminTorrentsPage() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()
  const enabled = hasFeature('torrent_cache')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getTorrentCacheSettings,
    enabled,
  })

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title={t('admin.torrents.title')}
        description={t('admin.torrents.description')}
        badge={<ProBadge tooltip={t('admin.torrents.proTooltip')} />}
        actions={
          enabled ? (
            <Button variant="outline" onClick={() => setSettingsOpen(true)} disabled={!settingsQuery.data}>
              <Settings2 />
              {t('admin.torrents.settings.open')}
            </Button>
          ) : undefined
        }
      />

      {entitlementLoading ? null : !enabled ? (
        <UpgradeHint
          feature="torrent_cache"
          title={t('admin.torrents.upgradeTitle')}
          description={t('admin.torrents.upgradeDescription')}
          actionLabel={t('admin.torrents.upgradeButton')}
        />
      ) : (
        <>
          <CacheSettingsSummary settings={settingsQuery.data} />
          <TorrentTable />
          {settingsQuery.data && (
            <TorrentCacheSettingsDrawer
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              settings={settingsQuery.data}
            />
          )}
        </>
      )}
    </div>
  )
}

function CacheSettingsSummary({ settings }: { settings: TorrentCacheSettings | undefined }) {
  const { t } = useTranslation()
  if (!settings) return null
  return (
    <p className="text-sm text-muted-foreground" data-testid="torrent-cache-settings-summary">
      {t('admin.torrents.settings.summary', {
        days: settings.retentionDays,
        capacity:
          settings.capacityBytes === null
            ? t('admin.torrents.settings.noCapacity')
            : formatSize(settings.capacityBytes),
      })}
    </p>
  )
}

function TorrentTable() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listSearch = useSearch({ from: '/_authenticated/admin/torrents' })
  const pageSize = listSearch.size ?? DEFAULT_PAGE_SIZE
  const pager = useCursorPager(String(pageSize))
  const [evictTarget, setEvictTarget] = useState<AdminTorrent | null>(null)

  const query = useQuery({
    queryKey: ['admin', 'torrents', pageSize, pager.pageToken],
    queryFn: () => listCachedTorrents({ pageToken: pager.pageToken, pageSize }),
    placeholderData: keepPreviousData,
  })

  const evictMutation = useMutation({
    mutationFn: (id: string) => evictCachedTorrent(id),
    onSuccess: () => {
      setEvictTarget(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'torrents'] })
    },
    onError: (err) => {
      setEvictTarget(null)
      toast.error(err.message)
    },
  })

  const items = query.data?.items ?? []

  if (query.error) {
    return <LoadErrorAlert error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="w-[40%] px-4 py-3 font-medium md:w-[28%]">{t('admin.torrents.col.name')}</th>
              <th className="w-[18%] px-4 py-3 font-medium md:w-[9%]">{t('admin.torrents.col.size')}</th>
              <th className="hidden w-[8%] px-4 py-3 font-medium sm:table-cell">{t('admin.torrents.col.holders')}</th>
              <th className="w-[24%] px-4 py-3 font-medium md:w-[11%]">{t('admin.torrents.col.status')}</th>
              <th className="hidden w-[11%] px-4 py-3 font-medium md:table-cell">{t('admin.torrents.col.verified')}</th>
              <th className="hidden w-[14%] px-4 py-3 font-medium lg:table-cell">
                {t('admin.torrents.col.lastAccess')}
              </th>
              <th className="hidden w-[12%] px-4 py-3 font-medium lg:table-cell">{t('admin.torrents.col.source')}</th>
              <th className="w-[18%] px-4 py-3 text-right font-medium md:w-[7%]">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {query.isPending ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  <div role="status" aria-live="polite">
                    {t('common.loading')}
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center">
                  <p className="font-medium">{t('admin.torrents.emptyTitle')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('admin.torrents.emptyHint')}</p>
                </td>
              </tr>
            ) : (
              items.map((torrent) => (
                <TorrentRow key={torrent.id} torrent={torrent} onEvict={() => setEvictTarget(torrent)} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {!query.isPending && (
        <CursorPagination
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          hasPrevious={pager.hasPrevious}
          nextPageToken={query.data?.nextPageToken}
          disabled={query.isFetching}
          onPageSizeChange={(size) =>
            navigate({ to: '/admin/torrents', search: { size: size === DEFAULT_PAGE_SIZE ? undefined : size } })
          }
          onPrevious={pager.previous}
          onNext={pager.next}
        />
      )}

      <ConfirmActionDialog
        open={evictTarget !== null}
        onOpenChange={(open) => !open && setEvictTarget(null)}
        title={t('admin.torrents.evict.title', { name: evictTarget?.name ?? '' })}
        description={t('admin.torrents.evict.description', { size: formatSize(evictTarget?.totalSize ?? 0) })}
        confirmLabel={t('admin.torrents.evict.confirm')}
        isPending={evictMutation.isPending}
        onConfirm={() => evictTarget && evictMutation.mutate(evictTarget.id)}
      />
    </>
  )
}

function statusVariant(status: AdminTorrent['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready') return 'default'
  if (status === 'invalid') return 'destructive'
  if (status === 'evicting') return 'outline'
  return 'secondary'
}

function TorrentRow({ torrent, onEvict }: { torrent: AdminTorrent; onEvict: () => void }) {
  const { t } = useTranslation()
  const inProgress = torrent.status === 'downloading' || torrent.status === 'verifying' || torrent.status === 'evicting'
  const blockedReason =
    torrent.holders > 0
      ? t('admin.torrents.evict.held', { count: torrent.holders })
      : inProgress
        ? t('admin.torrents.evict.inProgress')
        : null
  const lastAccess = new Date(torrent.lastAccessedAt)

  return (
    <tr className="border-b last:border-b-0" data-testid={`torrent-row-${torrent.id}`}>
      <td className="px-4 py-3">
        <div className="truncate font-medium" title={torrent.name}>
          {torrent.name}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground" title={torrent.infoHash}>
          {torrent.infoHash}
        </div>
      </td>
      <td className="px-4 py-3 tabular-nums">
        <div>{formatSize(torrent.totalSize)}</div>
        <div className="text-xs text-muted-foreground">
          {t('admin.torrents.fileCount', { count: torrent.fileCount })}
        </div>
      </td>
      <td className="hidden px-4 py-3 tabular-nums sm:table-cell">{torrent.holders}</td>
      <td className="px-4 py-3">
        <Badge variant={statusVariant(torrent.status)}>{t(`admin.torrents.status.${torrent.status}`)}</Badge>
      </td>
      <td className="hidden px-4 py-3 md:table-cell">{t(`admin.torrents.verified.${torrent.verified ?? 'none'}`)}</td>
      <td className="hidden px-4 py-3 lg:table-cell" title={lastAccess.toLocaleString()}>
        {lastAccess.toLocaleDateString()}
      </td>
      <td className="hidden truncate px-4 py-3 lg:table-cell">
        {torrent.sourceDownloader ? (
          (torrent.sourceDownloader.name ?? t('admin.torrents.deletedDownloader'))
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A span keeps the tooltip reachable while the button is disabled. */}
            <span className="inline-flex" tabIndex={blockedReason ? 0 : -1}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onEvict}
                disabled={blockedReason !== null}
                aria-label={t('admin.torrents.evict.action', { name: torrent.name })}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{blockedReason ?? t('admin.torrents.evict.tooltip')}</TooltipContent>
        </Tooltip>
      </td>
    </tr>
  )
}
