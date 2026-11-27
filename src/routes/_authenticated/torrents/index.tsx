import type { WorkspaceTorrent } from '@shared/schemas'
import { keepPreviousData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { FolderInput, Magnet, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConfirmActionDialog } from '@/components/admin/confirm-action-dialog'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import { MoveDialog } from '@/components/files/dialogs/move-dialog'
import { PageHeader } from '@/components/layout/page-header'
import { ProBadge } from '@/components/ProBadge'
import { TorrentSheet, workspaceTorrentQueryKey } from '@/components/torrents/torrent-sheet'
import { TorrentStatusBadge } from '@/components/torrents/torrent-status-badge'
import { UpgradeHint } from '@/components/UpgradeHint'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useUrlText } from '@/hooks/use-url-text'
import { useEntitlement } from '@/hooks/useEntitlement'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { useServerEventSubscription } from '@/hooks/useServerEvents'
import { deleteWorkspaceTorrent, listWorkspaceTorrents, saveWorkspaceTorrentToDrive } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'

export const torrentsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  id: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/torrents/')({
  validateSearch: torrentsSearchSchema,
  component: TorrentsPage,
})

const QUERY_KEY = ['workspace-torrents', 'list']
const PAGE_SIZE = 50
// Entries still on their way refresh on their own until they settle.
const REFRESH_MS = 5000

export function TorrentsPage() {
  const { t } = useTranslation()
  const { hasFeature, isLoading: entitlementLoading } = useEntitlement()

  return (
    <div className="space-y-4">
      <PageHeader
        items={[
          {
            label: t('torrents.title'),
            icon: <Magnet className="size-4 text-muted-foreground" />,
          },
        ]}
        actions={!entitlementLoading && !hasFeature('torrents') ? <ProBadge /> : undefined}
      />
      {entitlementLoading ? (
        <p className="py-20 text-center text-sm text-muted-foreground" role="status">
          {t('common.loading')}
        </p>
      ) : hasFeature('torrents') ? (
        <TorrentsList />
      ) : (
        <UpgradeHint feature="torrents" />
      )}
    </div>
  )
}

function TorrentsList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/torrents/' })
  const search = useSearch({ from: '/_authenticated/torrents/' })
  const [text, setText] = useUrlText(search.q ?? '', (value) =>
    navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  )
  // Each dialog keeps its target while it closes, so its title does not blank
  // out during the closing animation.
  const [saveTarget, setSaveTarget] = useState<WorkspaceTorrent | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WorkspaceTorrent | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  function askSave(entry: WorkspaceTorrent) {
    setSaveTarget(entry)
    setSaveOpen(true)
  }

  function askRemove(entry: WorkspaceTorrent) {
    setRemoveTarget(entry)
    setRemoveOpen(true)
  }

  const query = useInfiniteQuery({
    queryKey: [...QUERY_KEY, search.q ?? ''],
    queryFn: ({ pageParam }) => listWorkspaceTorrents({ pageToken: pageParam, pageSize: PAGE_SIZE, search: search.q }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: (current) =>
      current.state.data?.pages.some((page) =>
        page.items.some((item) => item.status !== 'ready' && item.status !== 'failed'),
      )
        ? REFRESH_MS
        : false,
  })
  const loadMoreRef = useInfiniteScroll<HTMLDivElement>({
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  })
  useServerEventSubscription('torrents-page', ['download_task'], () => {
    queryClient.invalidateQueries({ queryKey: ['workspace-torrents'] })
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []

  function openEntry(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, id }) })
  }

  const saveMutation = useMutation({
    mutationFn: ({ entry, folder }: { entry: WorkspaceTorrent; folder: string }) =>
      saveWorkspaceTorrentToDrive(entry.id, folder),
    onSuccess: (_result, { entry, folder }) => {
      setSaveOpen(false)
      queryClient.invalidateQueries({ queryKey: ['objects'] })
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      toast.success(t('torrents.save.success', { name: entry.name, folder: folder || t('torrents.save.root') }))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('common.error')),
  })

  const removeMutation = useMutation({
    mutationFn: (entry: WorkspaceTorrent) => deleteWorkspaceTorrent(entry.id),
    onSuccess: (_result, entry) => {
      setRemoveOpen(false)
      if (search.id === entry.id) openEntry(undefined)
      queryClient.removeQueries({ queryKey: workspaceTorrentQueryKey(entry.id) })
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('common.error')),
  })

  return (
    <>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('torrents.searchPlaceholder')}
          aria-label={t('torrents.search')}
          className="h-9 pl-8"
        />
      </div>

      {query.isPending ? (
        <p className="py-20 text-center text-sm text-muted-foreground" role="status">
          {t('common.loading')}
        </p>
      ) : query.isError && !query.data ? (
        <LoadErrorAlert error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <Magnet className="size-12 text-muted-foreground" />
          <p className="font-medium">{search.q ? t('torrents.noMatchTitle') : t('torrents.emptyTitle')}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {search.q ? t('torrents.noMatchHint') : t('torrents.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="w-[46%] px-4 py-3 font-medium md:w-[40%]">{t('torrents.col.name')}</th>
                <th className="hidden w-[12%] px-4 py-3 font-medium sm:table-cell">{t('torrents.col.size')}</th>
                <th className="w-[30%] px-4 py-3 font-medium md:w-[16%]">{t('torrents.col.status')}</th>
                <th className="hidden w-[14%] px-4 py-3 font-medium md:table-cell">{t('torrents.col.source')}</th>
                <th className="hidden w-[12%] px-4 py-3 font-medium lg:table-cell">{t('torrents.col.added')}</th>
                <th className="w-[24%] px-4 py-3 text-right font-medium md:w-[8%]">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr
                  key={entry.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                  data-testid={`torrent-entry-${entry.id}`}
                  onClick={() => openEntry(entry.id)}
                >
                  <td className="px-4 py-3">
                    <div className="truncate font-medium" title={entry.name}>
                      {entry.name}
                    </div>
                    {entry.status === 'failed' && entry.error && (
                      <div className="truncate text-xs text-destructive" title={entry.error}>
                        {entry.error}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums sm:table-cell">
                    {entry.size === null ? '—' : formatSize(entry.size)}
                  </td>
                  <td className="px-4 py-3">
                    <TorrentStatusBadge status={entry.status} />
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">{t(`torrents.source.${entry.source}`)}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">{formatDate(entry.createdAt)}</td>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the cell only stops the row's click */}
                  <td className="px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('torrents.rowActions', { name: entry.name })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEntry(entry.id)}>{t('torrents.open')}</DropdownMenuItem>
                        <DropdownMenuItem disabled={entry.status !== 'ready'} onClick={() => askSave(entry)}>
                          <FolderInput />
                          {t('torrents.save.action')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => askRemove(entry)}>
                          <Trash2 />
                          {t('torrents.remove.action')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.isFetchNextPageError ? (
        <LoadErrorAlert error={query.error} onRetry={() => query.fetchNextPage()} retrying={query.isFetchingNextPage} />
      ) : (
        query.hasNextPage && (
          <div ref={loadMoreRef} className="py-3 text-center text-sm text-muted-foreground">
            {query.isFetchingNextPage ? t('common.loading') : ''}
          </div>
        )
      )}

      <TorrentSheet
        id={search.id ?? null}
        onOpenChange={(open) => !open && openEntry(undefined)}
        onSave={askSave}
        onRemove={askRemove}
      />

      <MoveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onConfirm={(folder) => saveTarget && saveMutation.mutate({ entry: saveTarget, folder })}
        isPending={saveMutation.isPending}
        excludeIds={[]}
        title={t('torrents.save.title', { name: saveTarget?.name ?? '' })}
        confirmLabel={t('torrents.save.confirm')}
      />

      <ConfirmActionDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('torrents.remove.title', { name: removeTarget?.name ?? '' })}
        description={t('torrents.remove.description')}
        confirmLabel={t('torrents.remove.confirm')}
        isPending={removeMutation.isPending}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget)}
      />
    </>
  )
}
