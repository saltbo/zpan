import type { Downloader } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Activity, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deleteDownloader, listDownloaders, updateDownloader } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/downloaders')({
  component: AdminDownloadersPage,
})

const QUERY_KEY = ['admin', 'downloaders']

function AdminDownloadersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<Downloader | null>(null)

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listDownloaders,
    refetchInterval: 5000,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateDownloader(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDownloader(id),
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('admin.downloaders.deleteSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const downloaders = query.data?.items ?? []

  return (
    <div className="max-w-6xl space-y-4">
      <AdminPageHeader title={t('admin.downloaders.title')} description={t('admin.downloaders.subtitle')} />

      <section className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.downloaders.table.name')}</TableHead>
              <TableHead>{t('admin.downloaders.table.status')}</TableHead>
              <TableHead>{t('admin.downloaders.table.engine')}</TableHead>
              <TableHead>{t('admin.downloaders.table.tasks')}</TableHead>
              <TableHead>{t('admin.downloaders.table.speed')}</TableHead>
              <TableHead>{t('admin.downloaders.table.billing')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {downloaders.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                  {query.isLoading ? t('common.loading') : t('admin.downloaders.empty')}
                </TableCell>
              </TableRow>
            )}
            {downloaders.map((downloader) => (
              <DownloaderRow
                key={downloader.id}
                downloader={downloader}
                onToggle={(enabled) => toggleMutation.mutate({ id: downloader.id, enabled })}
                onDelete={() => setDeleteTarget(downloader)}
              />
            ))}
          </TableBody>
        </Table>
      </section>
      <DeleteDownloaderDialog
        downloader={deleteTarget}
        open={deleteTarget !== null}
        pending={deleteMutation.isPending}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  )
}

function DownloaderRow({
  downloader,
  onToggle,
  onDelete,
}: {
  downloader: Downloader
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{downloader.name}</div>
        <div className="text-xs text-muted-foreground">
          {downloader.hostname} · {downloader.platform}/{downloader.arch}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={
            downloader.status === 'online' ? 'default' : downloader.status === 'disabled' ? 'outline' : 'secondary'
          }
        >
          {t(`admin.downloaders.status.${downloader.status}`)}
        </Badge>
        {downloader.lastHeartbeatAt && (
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Activity className="size-3" />
            {new Date(downloader.lastHeartbeatAt).toLocaleString()}
          </div>
        )}
      </TableCell>
      <TableCell>{downloader.engine}</TableCell>
      <TableCell>
        {downloader.currentTasks} / {downloader.maxConcurrentTasks}
      </TableCell>
      <TableCell>
        {formatBytes(downloader.downloadBps)}/s · {formatBytes(downloader.uploadBps)}/s
      </TableCell>
      <TableCell>
        {downloader.remoteDownloadCreditBillingEnabled
          ? `${downloader.remoteDownloadCreditPerUnit} / ${formatBytes(downloader.remoteDownloadCreditUnitBytes)}`
          : t('common.disabled')}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Switch checked={downloader.enabled} onCheckedChange={onToggle} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={t('admin.downloaders.delete')}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function DeleteDownloaderDialog({
  downloader,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  downloader: Downloader | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.downloaders.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t('admin.downloaders.deleteConfirm', { name: downloader?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={pending}>
            {t('admin.downloaders.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}
