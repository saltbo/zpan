import { DirType } from '@shared/constants'
import type { DownloadTask, DownloadTaskStatus, StorageObject } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  Folder,
  FolderInput,
  Gauge,
  Home,
  LinkIcon,
  Magnet,
  PauseCircle,
  Plus,
  RadioTower,
  RotateCw,
  Upload,
  Users,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useFilesQuery } from '@/components/files/hooks/use-files-query'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { createDownloadTask, listDownloadTasks, updateDownloadTask } from '@/lib/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/downloads/')({
  component: DownloadsPage,
})

const QUERY_KEY = ['download-tasks']
const ACTIVE_STATUSES = new Set<DownloadTaskStatus>(['queued', 'assigned', 'running', 'billing_paused', 'uploading'])
type DetailTab = 'overview' | 'trackers' | 'peers' | 'files' | 'log'

const DETAIL_TABS: Array<{ id: DetailTab; labelKey: string; icon: ReactNode }> = [
  { id: 'overview', labelKey: 'downloads.detail.tabs.overview', icon: <Gauge className="size-4" /> },
  { id: 'trackers', labelKey: 'downloads.detail.tabs.trackers', icon: <RadioTower className="size-4" /> },
  { id: 'peers', labelKey: 'downloads.detail.tabs.peers', icon: <Users className="size-4" /> },
  { id: 'files', labelKey: 'downloads.detail.tabs.files', icon: <FileDown className="size-4" /> },
  { id: 'log', labelKey: 'downloads.detail.tabs.log', icon: <AlertCircle className="size-4" /> },
]

function DownloadsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [sourceType, setSourceType] = useState<'http' | 'magnet' | 'torrent_url'>('http')
  const [uri, setUri] = useState('')
  const [targetFolder, setTargetFolder] = useState('')
  const [name, setName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')

  const tasksQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => listDownloadTasks({ page: 1, pageSize: 50 }),
    refetchInterval: 2000,
  })

  const createMutation = useMutation({
    mutationFn: createDownloadTask,
    onSuccess: () => {
      setUri('')
      setName('')
      setTargetFolder('')
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('downloads.createSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const pauseMutation = useMutation({
    mutationFn: (id: string) => updateDownloadTask(id, { status: 'canceled' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('downloads.cancelSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate({
      source: { type: sourceType, uri: uri.trim() },
      targetFolder: targetFolder.trim(),
      name: name.trim() || undefined,
    })
  }

  const tasks = tasksQuery.data?.items ?? []
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
  const activeSelectedTaskId = selectedTask?.id ?? null

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] flex-col gap-2">
      <PageHeader
        items={[{ label: t('downloads.title'), icon: <Download className="size-4 text-muted-foreground" /> }]}
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('downloads.create')}
          </Button>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('downloads.createTitle')}</DialogTitle>
          </DialogHeader>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="download-source-type">{t('downloads.sourceType')}</Label>
              <ToggleGroup
                id="download-source-type"
                type="single"
                variant="outline"
                value={sourceType}
                onValueChange={(value) => value && setSourceType(value as typeof sourceType)}
                className="grid w-full grid-cols-3"
              >
                <ToggleGroupItem value="http" className="h-14 flex-col gap-1 px-2">
                  <LinkIcon className="size-4" />
                  <span className="text-xs">{t('downloads.sourceTypes.http')}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="magnet" className="h-14 flex-col gap-1 px-2">
                  <Magnet className="size-4" />
                  <span className="text-xs">{t('downloads.sourceTypes.magnet')}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="torrent_url" className="h-14 flex-col gap-1 px-2">
                  <FileDown className="size-4" />
                  <span className="text-xs">{t('downloads.sourceTypes.torrentUrl')}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="download-uri">{t('downloads.uri')}</Label>
              <Textarea
                id="download-uri"
                value={uri}
                onChange={(event) => setUri(event.target.value)}
                placeholder={t('downloads.uriPlaceholder')}
                className="min-h-28 resize-y font-mono text-sm"
                required
              />
            </div>

            <div className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="download-target" className="flex items-center gap-2">
                  <FolderInput className="size-4 text-muted-foreground" />
                  {t('downloads.targetFolder')}
                </Label>
                <FolderPicker value={targetFolder} onChange={setTargetFolder} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="download-name" className="flex items-center gap-2">
                  <FileDown className="size-4 text-muted-foreground" />
                  {t('downloads.name')}
                </Label>
                <Input
                  id="download-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('downloads.namePlaceholder')}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || !uri.trim()}>
                <Plus className="size-4" />
                {t('downloads.start')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
        <div className="max-h-[52dvh] overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">{t('downloads.table.source')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.status')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.progress')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.size')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.speed')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.peers')}</TableHead>
                <TableHead className="h-8">{t('downloads.table.eta')}</TableHead>
                <TableHead className="h-8 text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                    {tasksQuery.isLoading ? t('common.loading') : t('downloads.empty')}
                  </TableCell>
                </TableRow>
              )}
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === activeSelectedTaskId}
                  onSelect={() => setSelectedTaskId(task.id)}
                  onCancel={(id) => pauseMutation.mutate(id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="min-h-[18rem] overflow-hidden rounded-md border bg-background">
        <DownloadInspector task={selectedTask} tab={detailTab} onTabChange={setDetailTab} />
      </section>
    </div>
  )
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function FolderPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [browsingPath, setBrowsingPath] = useState('')
  const query = useFilesQuery(browsingPath, 'folder')
  const folders = (query.data?.items ?? []).filter((item) => item.dirtype !== DirType.FILE)
  const breadcrumb = browsingPath ? browsingPath.split('/') : []
  const displayValue = value || t('downloads.targetFolderRoot')

  function navigateToIndex(index: number) {
    setBrowsingPath(index < 0 ? '' : breadcrumb.slice(0, index + 1).join('/'))
  }

  function navigateInto(folder: StorageObject) {
    setBrowsingPath(buildPath(browsingPath, folder.name))
  }

  function selectPath(path: string) {
    onChange(path)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="download-target"
          type="button"
          variant="outline"
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Folder className="size-4 shrink-0 text-blue-500" />
            <span className="truncate">{displayValue}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 rotate-90 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[60] w-96 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-3 py-2">
          <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <button type="button" className="shrink-0 hover:text-foreground" onClick={() => navigateToIndex(-1)}>
              <Home className="size-4" />
            </button>
            {breadcrumb.map((name, index) => (
              <span key={breadcrumb.slice(0, index + 1).join('/')} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3 shrink-0" />
                <button type="button" className="truncate hover:text-foreground" onClick={() => navigateToIndex(index)}>
                  {name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted ${
              value === '' ? 'bg-primary/10 text-primary' : ''
            }`}
            onClick={() => selectPath('')}
          >
            <Home className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('downloads.targetFolderRoot')}</span>
            {value === '' && <Check className="size-4 shrink-0" />}
          </button>

          {query.isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          )}
          {!query.isLoading && folders.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">{t('files.noFolders')}</div>
          )}
          {folders.map((folder) => {
            const folderPath = buildPath(browsingPath, folder.name)
            const selected = value === folderPath
            return (
              <div key={folder.id} className="flex items-center rounded-sm hover:bg-muted">
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm ${
                    selected ? 'text-primary' : ''
                  }`}
                  onClick={() => selectPath(folderPath)}
                >
                  <Folder className="size-4 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mr-1 size-8 shrink-0"
                  onClick={() => navigateInto(folder)}
                >
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Button>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TaskRow({
  task,
  selected,
  onSelect,
  onCancel,
}: {
  task: DownloadTask
  selected: boolean
  onSelect: () => void
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation()
  const total = task.totalBytes ?? task.downloadedBytes
  const progress = total > 0 ? Math.min(100, Math.round((task.downloadedBytes / total) * 100)) : 0
  const active = ACTIVE_STATUSES.has(task.status)
  const detail = task.detail
  const peers = detail?.peers ?? detail?.connections

  return (
    <TableRow
      className={cn('h-9 cursor-pointer hover:bg-muted/50', selected && 'bg-primary/5 hover:bg-primary/10')}
      onClick={onSelect}
    >
      <TableCell className="max-w-[28rem] py-1">
        <div className="flex min-w-0 items-center gap-2">
          <SourceIcon type={task.sourceType} />
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{getTaskTitle(task)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{task.sourceUri}</div>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-1">
        <StatusBadge status={task.status} />
        <div className="mt-0.5 max-w-32 truncate text-[11px] text-muted-foreground">
          {task.status === 'billing_paused' ? t('downloads.billingPaused') : detail?.phase || '-'}
        </div>
      </TableCell>
      <TableCell className="min-w-36 py-1">
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5" />
          <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap py-1 text-[11px] tabular-nums text-muted-foreground">
        {formatBytes(task.downloadedBytes)} / {task.totalBytes ? formatBytes(task.totalBytes) : t('downloads.unknown')}
      </TableCell>
      <TableCell className="whitespace-nowrap py-1 text-[11px] tabular-nums">
        <div>{formatBytes(task.downloadBps)}/s ↓</div>
        <div className="text-muted-foreground">{formatBytes(task.uploadBps)}/s ↑</div>
      </TableCell>
      <TableCell className="whitespace-nowrap py-1 text-[11px] tabular-nums text-muted-foreground">
        {formatNumber(detail?.seeders)} / {formatNumber(peers)}
      </TableCell>
      <TableCell className="whitespace-nowrap py-1 text-[11px] tabular-nums text-muted-foreground">
        {formatDuration(detail?.etaSeconds)}
      </TableCell>
      <TableCell className="py-1 text-right">
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation()
              onCancel(task.id)
            }}
          >
            <PauseCircle className="size-4" />
            {t('downloads.cancel')}
          </Button>
        ) : (
          <RotateCw className="ml-auto size-4 text-muted-foreground" />
        )}
      </TableCell>
    </TableRow>
  )
}

function DownloadInspector({
  task,
  tab,
  onTabChange,
}: {
  task: DownloadTask | null
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
}) {
  const { t } = useTranslation()

  if (!task) {
    return (
      <div className="flex h-full min-h-[18rem] items-center justify-center text-sm text-muted-foreground">
        {t('downloads.detail.noSelection')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[18rem] flex-col">
      <div className="flex overflow-x-auto border-b bg-muted/20 px-1" role="tablist">
        {DETAIL_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={cn(
              'flex h-8 items-center gap-1.5 border-b-2 px-2 text-xs text-muted-foreground transition-colors [&_svg]:size-3.5',
              tab === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent hover:border-muted-foreground/30 hover:text-foreground',
            )}
            onClick={() => onTabChange(item.id)}
          >
            {item.icon}
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === 'overview' && <OverviewPanel task={task} />}
        {tab === 'trackers' && <TrackersPanel task={task} />}
        {tab === 'peers' && <PeersPanel task={task} />}
        {tab === 'files' && <FilesPanel task={task} />}
        {tab === 'log' && <LogPanel task={task} />}
      </div>
    </div>
  )
}

function OverviewPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const detail = task.detail
  const total = task.totalBytes ?? task.downloadedBytes
  const progress = total > 0 ? Math.min(100, Math.round((task.downloadedBytes / total) * 100)) : 0

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        <InspectorMetric
          icon={<Gauge className="size-4" />}
          label={t('downloads.detail.downloadSpeed')}
          value={`${formatBytes(task.downloadBps)}/s`}
        />
        <InspectorMetric
          icon={<Upload className="size-4" />}
          label={t('downloads.detail.uploadSpeed')}
          value={`${formatBytes(task.uploadBps)}/s`}
        />
        <InspectorMetric
          icon={<Users className="size-4" />}
          label={t('downloads.detail.connections')}
          value={formatNumber(detail?.connections)}
        />
        <InspectorMetric
          icon={<Clock className="size-4" />}
          label={t('downloads.detail.eta')}
          value={formatDuration(detail?.etaSeconds)}
        />
      </div>

      <div className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <InspectorField label={t('downloads.detail.progress')} value={`${progress}%`} />
        <InspectorField label={t('downloads.detail.engine')} value={detail?.engine || t('downloads.unknown')} />
        <InspectorField label={t('downloads.detail.phase')} value={detail?.phase || '-'} />
        <InspectorField
          label={t('downloads.detail.target')}
          value={task.targetFolder || t('downloads.targetFolderRoot')}
        />
        <InspectorField
          label={t('downloads.detail.sourceType')}
          value={t(`downloads.sourceTypes.${sourceTypeKey(task)}`)}
        />
        <InspectorField label={t('downloads.detail.source')} value={task.sourceUri} />
        <InspectorField
          label={t('downloads.detail.size')}
          value={`${formatBytes(task.downloadedBytes)} / ${task.totalBytes ? formatBytes(task.totalBytes) : t('downloads.unknown')}`}
        />
        <InspectorField
          label={t('downloads.detail.billing')}
          value={`${formatBytes(task.billedBytes)} / ${task.billedCredits} credits`}
        />
        <InspectorField label={t('downloads.detail.infoHash')} value={detail?.infoHash || '-'} />
        <InspectorField label={t('downloads.detail.torrentName')} value={detail?.torrentName || '-'} />
        <InspectorField label={t('downloads.detail.seeders')} value={formatNumber(detail?.seeders)} />
        <InspectorField label={t('downloads.detail.leechers')} value={formatNumber(detail?.leechers)} />
        <InspectorField label={t('downloads.detail.uploaded')} value={formatBytes(detail?.uploadedBytes ?? 0)} />
        <InspectorField label={t('downloads.detail.createdAt')} value={formatDate(task.createdAt)} />
        <InspectorField label={t('downloads.detail.startedAt')} value={formatDate(task.startedAt)} />
        <InspectorField label={t('downloads.detail.finishedAt')} value={formatDate(task.finishedAt)} />
      </div>

      {(task.errorMessage || detail?.message) && (
        <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1 break-words">
            {task.errorMessage && <div>{task.errorMessage}</div>}
            {detail?.message && <div>{detail.message}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function TrackersPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const trackers = task.detail?.trackers ?? []

  if (trackers.length === 0) return <EmptyPanel text={t('downloads.detail.noTrackers')} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('downloads.detail.trackerUrl')}</TableHead>
          <TableHead>{t('downloads.detail.trackerStatus')}</TableHead>
          <TableHead>{t('downloads.detail.seeders')}</TableHead>
          <TableHead>{t('downloads.detail.peers')}</TableHead>
          <TableHead>{t('downloads.detail.statusMessage')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trackers.map((tracker) => (
          <TableRow key={tracker.url}>
            <TableCell className="max-w-[34rem] truncate font-mono text-xs">{tracker.url}</TableCell>
            <TableCell>{tracker.status || '-'}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(tracker.seeds)}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(tracker.peers)}</TableCell>
            <TableCell className="max-w-[24rem] truncate text-muted-foreground">{tracker.message || '-'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PeersPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const peers = task.detail?.peerSamples ?? []

  if (peers.length === 0) return <EmptyPanel text={t('downloads.detail.noPeers')} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('downloads.detail.peerAddress')}</TableHead>
          <TableHead>{t('downloads.detail.peerClient')}</TableHead>
          <TableHead>{t('downloads.detail.progress')}</TableHead>
          <TableHead>{t('downloads.detail.downloadSpeed')}</TableHead>
          <TableHead>{t('downloads.detail.uploadSpeed')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {peers.map((peer) => (
          <TableRow key={peer.address}>
            <TableCell className="font-mono text-xs">{peer.address}</TableCell>
            <TableCell className="max-w-[20rem] truncate">{peer.client || '-'}</TableCell>
            <TableCell className="tabular-nums">{formatPercent(peer.progress)}</TableCell>
            <TableCell className="tabular-nums">{formatBytes(peer.downloadBps ?? 0)}/s</TableCell>
            <TableCell className="tabular-nums">{formatBytes(peer.uploadBps ?? 0)}/s</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function FilesPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const files = task.detail?.files ?? []

  if (files.length === 0) return <EmptyPanel text={t('downloads.detail.noFiles')} />

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('downloads.detail.filePath')}</TableHead>
          <TableHead>{t('downloads.detail.progress')}</TableHead>
          <TableHead>{t('downloads.detail.size')}</TableHead>
          <TableHead>{t('downloads.detail.fileStatus')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const progress = file.size > 0 ? Math.min(100, Math.round(((file.completedBytes ?? 0) / file.size) * 100)) : 0
          return (
            <TableRow key={file.path}>
              <TableCell className="max-w-[38rem] truncate">{file.path}</TableCell>
              <TableCell className="min-w-40">
                <div className="flex items-center gap-2">
                  <Progress value={progress} className="h-1.5" />
                  <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                {formatBytes(file.completedBytes ?? 0)} / {formatBytes(file.size)}
              </TableCell>
              <TableCell>
                {file.selected === false ? t('downloads.detail.skipped') : t('downloads.detail.selected')}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function LogPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const detail = task.detail
  const messages = [
    detail?.message && { label: t('downloads.detail.statusMessage'), value: detail.message },
    task.errorMessage && { label: t('downloads.detail.errorMessage'), value: task.errorMessage },
    { label: t('downloads.detail.createdAt'), value: formatDate(task.createdAt) },
    { label: t('downloads.detail.startedAt'), value: formatDate(task.startedAt) },
    { label: t('downloads.detail.finishedAt'), value: formatDate(task.finishedAt) },
  ].filter(Boolean) as Array<{ label: string; value: string }>

  return (
    <div className="space-y-2 font-mono text-xs">
      {messages.map((message) => (
        <div key={message.label} className="grid gap-2 rounded-sm border px-3 py-2 sm:grid-cols-[10rem_1fr]">
          <div className="text-muted-foreground">{message.label}</div>
          <div className="min-w-0 break-words">{message.value || '-'}</div>
        </div>
      ))}
      {messages.length === 0 && <EmptyPanel text={t('downloads.detail.noLog')} />}
    </div>
  )
}

function SourceIcon({ type }: { type: DownloadTask['sourceType'] }) {
  if (type === 'magnet') return <Magnet className="size-4 shrink-0 text-amber-500" />
  if (type === 'torrent_url') return <FileDown className="size-4 shrink-0 text-violet-500" />
  return <LinkIcon className="size-4 shrink-0 text-blue-500" />
}

function InspectorMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-sm border bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground [&_svg]:size-3.5">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 truncate text-xs font-medium tabular-nums">{value}</div>
    </div>
  )
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-sm border border-dashed text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function getTaskTitle(task: DownloadTask) {
  return task.detail?.torrentName || task.name || filenameFromUri(task.sourceUri) || task.sourceUri
}

function filenameFromUri(uri: string) {
  try {
    const parsed = new URL(uri)
    const name = parsed.pathname.split('/').filter(Boolean).at(-1)
    return name ? decodeURIComponent(name) : ''
  } catch {
    if (uri.startsWith('magnet:')) {
      const match = uri.match(/[?&]dn=([^&]+)/)
      return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : ''
    }
    return ''
  }
}

function sourceTypeKey(task: DownloadTask) {
  if (task.sourceType === 'torrent_url') return 'torrentUrl'
  return task.sourceType
}

function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '-'
  const normalized = (value as number) > 1 ? (value as number) : (value as number) * 100
  return `${Math.max(0, Math.min(100, normalized)).toFixed(1)}%`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function StatusBadge({ status }: { status: DownloadTaskStatus }) {
  const { t } = useTranslation()
  const variant =
    status === 'completed' ? 'default' : status === 'failed' || status === 'canceled' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{t(`downloads.status.${status}`)}</Badge>
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

function formatNumber(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat().format(value as number)
}

function formatDuration(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds) || seconds === null || seconds === undefined) return '-'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
