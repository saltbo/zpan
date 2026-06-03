import { DirType } from '@shared/constants'
import type { DownloadTask, DownloadTaskStatus, StorageObject } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Check,
  ChevronRight,
  Download,
  FileDown,
  Folder,
  FolderInput,
  Home,
  LinkIcon,
  Magnet,
  PauseCircle,
  Plus,
  RotateCw,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
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

export const Route = createFileRoute('/_authenticated/downloads/')({
  component: DownloadsPage,
})

const QUERY_KEY = ['download-tasks']
const ACTIVE_STATUSES = new Set<DownloadTaskStatus>(['queued', 'assigned', 'running', 'billing_paused', 'uploading'])

function DownloadsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [sourceType, setSourceType] = useState<'http' | 'magnet' | 'torrent_url'>('http')
  const [uri, setUri] = useState('')
  const [targetFolder, setTargetFolder] = useState('')
  const [name, setName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

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

  return (
    <div className="space-y-4">
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

      <section className="rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('downloads.table.source')}</TableHead>
              <TableHead>{t('downloads.table.status')}</TableHead>
              <TableHead>{t('downloads.table.progress')}</TableHead>
              <TableHead>{t('downloads.table.speed')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                  {tasksQuery.isLoading ? t('common.loading') : t('downloads.empty')}
                </TableCell>
              </TableRow>
            )}
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onCancel={(id) => pauseMutation.mutate(id)} />
            ))}
          </TableBody>
        </Table>
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

function TaskRow({ task, onCancel }: { task: DownloadTask; onCancel: (id: string) => void }) {
  const { t } = useTranslation()
  const total = task.totalBytes ?? task.downloadedBytes
  const progress = total > 0 ? Math.min(100, Math.round((task.downloadedBytes / total) * 100)) : 0
  const active = ACTIVE_STATUSES.has(task.status)

  return (
    <TableRow>
      <TableCell className="max-w-[32rem]">
        <div className="flex items-center gap-2">
          <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{task.name || task.sourceUri}</div>
            <div className="truncate text-xs text-muted-foreground">{task.sourceUri}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={task.status} />
        {task.status === 'billing_paused' && (
          <div className="mt-1 text-xs text-muted-foreground">{t('downloads.billingPaused')}</div>
        )}
      </TableCell>
      <TableCell className="min-w-44">
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-2" />
          <span className="w-10 text-right text-xs text-muted-foreground">{progress}%</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatBytes(task.downloadedBytes)} /{' '}
          {task.totalBytes ? formatBytes(task.totalBytes) : t('downloads.unknown')}
        </div>
      </TableCell>
      <TableCell>{formatBytes(task.downloadBps)}/s</TableCell>
      <TableCell className="text-right">
        {active ? (
          <Button variant="ghost" size="sm" onClick={() => onCancel(task.id)}>
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
