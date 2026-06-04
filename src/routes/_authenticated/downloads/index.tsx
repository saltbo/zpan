import { DirType } from '@shared/constants'
import type { DownloadTask, DownloadTaskAction, DownloadTaskStatus, StorageObject } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  type ColumnDef,
  type ColumnOrderState,
  flexRender,
  getCoreRowModel,
  type Header,
  type Row,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  Filter,
  Folder,
  FolderInput,
  Gauge,
  Home,
  LinkIcon,
  LoaderCircle,
  Magnet,
  PauseCircle,
  PlayCircle,
  Plus,
  RadioTower,
  RotateCcw,
  Tag,
  Trash2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useFilesQuery } from '@/components/files/hooks/use-files-query'
import { PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { createDownloadTask, downloadTaskEventsUrl, listDownloadTasks, runDownloadTaskAction } from '@/lib/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/downloads/')({
  component: DownloadsPage,
})

const QUERY_KEY = ['download-tasks']
const PAUSABLE_STATUSES = new Set<DownloadTaskStatus>(['queued', 'assigned', 'running'])
const DEFAULT_COLUMN_ORDER = ['select', 'source', 'status', 'progress', 'eta', 'category', 'tags']
type DownloadTaskDisplayStatus = DownloadTaskStatus | 'seeding'
type DownloadTaskPhase = NonNullable<NonNullable<DownloadTask['detail']>['phase']>
type DetailTab = 'overview' | 'trackers' | 'peers' | 'files' | 'log'
type PanelDragState = { startY: number; startDetailHeight: number; containerHeight: number }
type PendingTaskAction = { tasks: DownloadTask[]; action: DownloadTaskAction }

const LIST_MIN_HEIGHT = 180
const DETAIL_MIN_HEIGHT = 224
const DETAIL_DEFAULT_HEIGHT = 320
const PANEL_RESIZER_HEIGHT = 8

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
  const [category, setCategory] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(DEFAULT_COLUMN_ORDER)
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const [pendingTaskAction, setPendingTaskAction] = useState<PendingTaskAction | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [detailHeight, setDetailHeight] = useState(DETAIL_DEFAULT_HEIGHT)
  const [panelDrag, setPanelDrag] = useState<PanelDragState | null>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  const categoryFilterValue = filterCategory.trim() || undefined
  const tagFilterValue = filterTag.trim() || undefined
  const sortBy = toDownloadTaskSortBy(sorting[0]?.id)
  const sortDir = sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : 'desc'
  const queryKey = useMemo(
    () => [...QUERY_KEY, categoryFilterValue ?? '', tagFilterValue ?? '', sortBy, sortDir],
    [categoryFilterValue, sortBy, sortDir, tagFilterValue],
  )

  const tasksQuery = useQuery({
    queryKey,
    queryFn: () =>
      listDownloadTasks({
        page: 1,
        pageSize: 50,
        category: categoryFilterValue,
        tag: tagFilterValue,
        sortBy,
        sortDir,
      }),
  })

  useEffect(() => {
    const events = new EventSource(
      downloadTaskEventsUrl({ category: categoryFilterValue, tag: tagFilterValue, sortBy, sortDir }),
      {
        withCredentials: true,
      },
    )
    events.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data)
      queryClient.setQueryData(queryKey, data)
    })
    return () => events.close()
  }, [categoryFilterValue, queryClient, queryKey, sortBy, sortDir, tagFilterValue])

  useEffect(() => {
    if (!panelDrag) return
    const drag = panelDrag

    function handlePointerMove(event: PointerEvent) {
      const maxDetailHeight = Math.max(DETAIL_MIN_HEIGHT, drag.containerHeight - PANEL_RESIZER_HEIGHT - LIST_MIN_HEIGHT)
      setDetailHeight(clamp(drag.startDetailHeight - (event.clientY - drag.startY), DETAIL_MIN_HEIGHT, maxDetailHeight))
    }

    function handlePointerUp() {
      setPanelDrag(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [panelDrag])

  const createMutation = useMutation({
    mutationFn: createDownloadTask,
    onSuccess: () => {
      setUri('')
      setName('')
      setTargetFolder('')
      setCategory('')
      setTagsInput('')
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('downloads.createSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const actionMutation = useMutation({
    mutationFn: async ({ tasks, action }: { tasks: DownloadTask[]; action: DownloadTaskAction }) => {
      const actionable = tasks.filter((task) => taskActions(task).includes(action))
      await Promise.all(actionable.map((task) => runDownloadTaskAction(task.id, action)))
      return { action, count: actionable.length }
    },
    onSuccess: ({ action }) => {
      if (action === 'delete') setRowSelection({})
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      toast.success(t('downloads.actionSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createMutation.mutate({
      source: { type: sourceType, uri: uri.trim() },
      targetFolder: targetFolder.trim(),
      name: name.trim() || undefined,
      category: category.trim() || undefined,
      tags: parseTagsInput(tagsInput),
    })
  }

  function handleTaskAction(task: DownloadTask, action: DownloadTaskAction) {
    requestTaskAction({ tasks: [task], action })
  }

  function handleBulkAction(action: DownloadTaskAction) {
    requestTaskAction({ tasks: selectedTasks, action })
  }

  function handlePrimaryTaskAction(task: DownloadTask) {
    const action = primaryTaskAction(task)
    if (action) handleTaskAction(task, action)
  }

  function handleColumnDrop(targetColumnId: string) {
    if (!draggedColumnId || draggedColumnId === targetColumnId) {
      setDraggedColumnId(null)
      return
    }
    if (!isReorderableColumn(draggedColumnId) || !isReorderableColumn(targetColumnId)) {
      setDraggedColumnId(null)
      return
    }
    setColumnOrder((current) => reorderColumn(current, draggedColumnId, targetColumnId))
    setDraggedColumnId(null)
  }

  function requestTaskAction(action: PendingTaskAction) {
    if (action.action === 'cancel' || action.action === 'delete') {
      setPendingTaskAction(action)
      return
    }
    actionMutation.mutate(action)
  }

  function confirmPendingTaskAction() {
    if (!pendingTaskAction) return
    actionMutation.mutate(pendingTaskAction)
    setPendingTaskAction(null)
  }

  const tasks = tasksQuery.data?.items ?? []
  const columns = useMemo(() => getDownloadColumns(t), [t])
  const table = useReactTable({
    data: tasks,
    columns,
    state: { sorting, rowSelection, columnOrder },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (task) => task.id,
    enableRowSelection: true,
    manualSorting: true,
  })
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
  const activeSelectedTaskId = selectedTask?.id ?? null
  const selectedTasks = table.getSelectedRowModel().rows.map((row) => row.original)

  function handlePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const containerHeight = panelsRef.current?.getBoundingClientRect().height ?? 0
    setPanelDrag({ startY: event.clientY, startDetailHeight: detailHeight, containerHeight })
  }

  function handlePanelResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const containerHeight = panelsRef.current?.getBoundingClientRect().height ?? 0
    const maxDetailHeight = Math.max(DETAIL_MIN_HEIGHT, containerHeight - PANEL_RESIZER_HEIGHT - LIST_MIN_HEIGHT)
    setDetailHeight((current) =>
      clamp(current + (event.key === 'ArrowUp' ? 24 : -24), DETAIL_MIN_HEIGHT, maxDetailHeight),
    )
  }

  return (
    <div className="flex h-[calc(100svh-5.5rem)] flex-col gap-2 overflow-hidden">
      <PageHeader
        items={[{ label: t('downloads.title'), icon: <Download className="size-4 text-muted-foreground" /> }]}
        actions={
          <div className="flex items-center gap-2">
            {selectedTasks.length > 0 && (
              <BulkTaskActions
                tasks={selectedTasks}
                pending={actionMutation.isPending}
                onAction={handleBulkAction}
                onClear={() => setRowSelection({})}
              />
            )}
            <DownloadFilters
              category={filterCategory}
              tag={filterTag}
              onCategoryChange={setFilterCategory}
              onTagChange={setFilterTag}
            />
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('downloads.create')}
            </Button>
          </div>
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
              <div className="space-y-2">
                <Label htmlFor="download-category" className="flex items-center gap-2">
                  <Tag className="size-4 text-muted-foreground" />
                  {t('downloads.category')}
                </Label>
                <Input
                  id="download-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder={t('downloads.categoryPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="download-tags" className="flex items-center gap-2">
                  <Tag className="size-4 text-muted-foreground" />
                  {t('downloads.tags')}
                </Label>
                <Input
                  id="download-tags"
                  value={tagsInput}
                  onChange={(event) => setTagsInput(event.target.value)}
                  placeholder={t('downloads.tagsPlaceholder')}
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

      <Dialog open={!!pendingTaskAction} onOpenChange={(open) => !open && setPendingTaskAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingTaskAction?.action === 'delete'
                ? t('downloads.confirm.deleteTitle')
                : t('downloads.confirm.cancelTitle')}
            </DialogTitle>
            <DialogDescription>
              {pendingTaskAction?.action === 'delete'
                ? t('downloads.confirm.deleteDescription', { count: pendingTaskAction.tasks.length })
                : t('downloads.confirm.cancelDescription', { count: pendingTaskAction?.tasks.length ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingTaskAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={actionMutation.isPending}
              onClick={confirmPendingTaskAction}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        ref={panelsRef}
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{
          gridTemplateRows: `minmax(${LIST_MIN_HEIGHT}px, 1fr) ${PANEL_RESIZER_HEIGHT}px minmax(${DETAIL_MIN_HEIGHT}px, ${detailHeight}px)`,
        }}
      >
        <section className="min-h-0 overflow-hidden rounded-md border bg-background">
          <div className="h-full overflow-auto">
            <Table className="min-w-[920px] table-fixed text-xs">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                    {headerGroup.headers.map((header) => (
                      <DownloadTableHead
                        key={header.id}
                        header={header}
                        draggedColumnId={draggedColumnId}
                        onDragStart={setDraggedColumnId}
                        onDrop={handleColumnDrop}
                      />
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {tasks.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={table.getAllColumns().length}
                      className="h-28 text-center text-muted-foreground"
                    >
                      {tasksQuery.isLoading ? t('common.loading') : t('downloads.empty')}
                    </TableCell>
                  </TableRow>
                )}
                {table.getRowModel().rows.map((row) => (
                  <TaskRow
                    key={row.id}
                    row={row}
                    selected={row.original.id === activeSelectedTaskId}
                    actionPending={actionMutation.isPending}
                    onSelect={() => setSelectedTaskId(row.original.id)}
                    onPrimaryAction={() => handlePrimaryTaskAction(row.original)}
                    onAction={(action) => handleTaskAction(row.original, action)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <button
          type="button"
          aria-label={t('downloads.resizePanel')}
          className={cn(
            'group flex cursor-row-resize touch-none items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            panelDrag && 'bg-primary/5',
          )}
          onPointerDown={handlePanelResizeStart}
          onKeyDown={handlePanelResizeKeyDown}
        >
          <span className="h-1 w-12 rounded-full bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary/60" />
        </button>

        <section className="min-h-0 overflow-hidden rounded-md border bg-background">
          <DownloadInspector task={selectedTask} tab={detailTab} onTabChange={setDetailTab} />
        </section>
      </div>
    </div>
  )
}

function DownloadFilters({
  category,
  tag,
  onCategoryChange,
  onTagChange,
}: {
  category: string
  tag: string
  onCategoryChange: (value: string) => void
  onTagChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const active = Boolean(category || tag)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={active ? 'secondary' : 'outline'} size="icon" title={t('downloads.filters')}>
          <Filter className="size-4" />
          <span className="sr-only">{t('downloads.filters')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[60] w-72 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="download-filter-category" className="text-xs">
            {t('downloads.category')}
          </Label>
          <Input
            id="download-filter-category"
            value={category}
            onChange={(event) => onCategoryChange(event.target.value)}
            placeholder={t('downloads.filterCategory')}
            className="h-8"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="download-filter-tag" className="text-xs">
            {t('downloads.tags')}
          </Label>
          <Input
            id="download-filter-tag"
            value={tag}
            onChange={(event) => onTagChange(event.target.value)}
            placeholder={t('downloads.filterTag')}
            className="h-8"
          />
        </div>
        {active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              onCategoryChange('')
              onTagChange('')
            }}
          >
            {t('common.clear')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SortIndicator({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (!direction) return null
  return direction === 'asc' ? (
    <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
  )
}

function DownloadTableHead({
  header,
  draggedColumnId,
  onDragStart,
  onDrop,
}: {
  header: Header<DownloadTask, unknown>
  draggedColumnId: string | null
  onDragStart: (columnId: string | null) => void
  onDrop: (columnId: string) => void
}) {
  const reorderable = isReorderableColumn(header.column.id)

  function handleDrop(event: ReactDragEvent<HTMLTableCellElement>) {
    event.preventDefault()
    onDrop(header.column.id)
  }

  return (
    <TableHead
      draggable={reorderable}
      className={cn(
        'h-8 overflow-hidden px-2',
        header.column.columnDef.meta?.className,
        header.column.getCanSort() && 'cursor-pointer select-none',
        reorderable && 'cursor-grab active:cursor-grabbing',
        draggedColumnId === header.column.id && 'opacity-50',
      )}
      style={header.column.columnDef.meta?.flex ? undefined : { width: header.column.getSize() }}
      onClick={header.column.getToggleSortingHandler()}
      onDragStart={(event) => {
        if (!reorderable) return
        onDragStart(header.column.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (reorderable && draggedColumnId) event.preventDefault()
      }}
      onDrop={handleDrop}
      onDragEnd={() => onDragStart(null)}
    >
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
        {header.column.getCanSort() && <SortIndicator direction={header.column.getIsSorted()} />}
      </div>
    </TableHead>
  )
}

function getDownloadColumns(t: ReturnType<typeof useTranslation>['t']): ColumnDef<DownloadTask>[] {
  return [
    {
      id: 'select',
      size: 34,
      enableSorting: false,
      meta: { className: 'w-8 px-2' },
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() ? 'indeterminate' : false)}
          aria-label={t('downloads.selectAll')}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          aria-label={t('downloads.selectTask')}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(event) => event.stopPropagation()}
        />
      ),
    },
    {
      id: 'source',
      accessorFn: (task) => `${getTaskTitle(task)} ${task.sourceUri}`,
      header: () => t('downloads.table.source'),
      size: 300,
      meta: { className: 'w-[300px] max-w-[300px]' },
      cell: ({ row }) => (
        <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
          <SourceIcon type={row.original.sourceType} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate text-xs font-medium">{getTaskTitle(row.original)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{row.original.sourceUri}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      accessorFn: (task) => task.category ?? '',
      header: () => t('downloads.table.category'),
      size: 110,
      cell: ({ row }) => <CategoryCell category={row.original.category} />,
    },
    {
      id: 'tags',
      accessorFn: (task) => task.tags.join(', '),
      header: () => t('downloads.table.tags'),
      size: 160,
      cell: ({ row }) => <TagsCell tags={row.original.tags} />,
    },
    {
      id: 'status',
      accessorFn: (task) => displayStatus(task),
      header: () => t('downloads.table.status'),
      size: 118,
      cell: ({ row }) => <StatusBadge status={displayStatus(row.original)} />,
    },
    {
      id: 'progress',
      accessorFn: (task) => transferProgress(task).overall,
      header: () => t('downloads.table.progress'),
      size: 260,
      cell: ({ row }) => <ProgressCell task={row.original} />,
    },
    {
      id: 'eta',
      accessorFn: (task) => task.detail?.etaSeconds ?? Number.MAX_SAFE_INTEGER,
      header: () => t('downloads.table.eta'),
      size: 92,
      cell: ({ row }) => (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatDuration(row.original.detail?.etaSeconds)}
        </span>
      ),
    },
  ]
}

function CategoryCell({ category }: { category: string | null }) {
  if (!category) return <span className="text-xs text-muted-foreground">-</span>
  return <span className="block max-w-28 truncate text-xs text-muted-foreground">{category}</span>
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">-</span>
  return (
    <div className="flex max-w-40 items-center gap-1 overflow-hidden">
      {tags.slice(0, 2).map((tag) => (
        <Badge key={tag} variant="outline" className="h-5 max-w-20 shrink px-1.5 text-[11px] font-normal">
          <span className="truncate">{tag}</span>
        </Badge>
      ))}
      {tags.length > 2 && <span className="text-[11px] text-muted-foreground">+{tags.length - 2}</span>}
    </div>
  )
}

function ProgressCell({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const progress = transferProgress(task)
  const sizeText = `${formatBytes(task.downloadedBytes)} / ${task.totalBytes ? formatBytes(task.totalBytes) : t('downloads.unknown')}`

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2">
        <TransferProgress task={task} className="h-1.5 flex-1" />
        <span className="w-9 shrink-0 text-right text-[11px] font-medium tabular-nums">{progress.overall}%</span>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span className="truncate">{sizeText}</span>
        <span className="whitespace-nowrap">
          <span className="text-foreground/80">{formatBytes(task.downloadBps)}/s</span>
          <span className="mx-1 text-muted-foreground/70">↓</span>
          <span>{formatBytes(task.storageUploadBps)}/s</span>
          <span className="ml-1 text-muted-foreground/70">↑</span>
        </span>
      </div>
    </div>
  )
}

function BulkTaskActions({
  tasks,
  pending,
  onAction,
  onClear,
}: {
  tasks: DownloadTask[]
  pending: boolean
  onAction: (action: DownloadTaskAction) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const actions = availableBulkActions(tasks)
  const primaryActions = actions.filter((action) => action !== 'cancel' && action !== 'delete')
  const destructiveActions = actions.filter((action) => action === 'cancel' || action === 'delete')

  return (
    <div className="flex h-9 items-center gap-1 rounded-md border bg-background px-2 shadow-xs">
      <span className="mr-1 whitespace-nowrap text-xs font-medium text-foreground">
        {t('downloads.selectedCount', { count: tasks.length })}
      </span>
      {primaryActions.map((action) => (
        <BulkActionButton key={action} action={action} pending={pending} onAction={onAction} />
      ))}
      {destructiveActions.length > 0 && <span className="mx-1 h-4 w-px bg-border" />}
      {destructiveActions.map((action) => (
        <BulkActionButton key={action} action={action} pending={pending} onAction={onAction} destructive />
      ))}
      <span className="mx-1 h-4 w-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={onClear}
      >
        {t('common.clear')}
      </Button>
    </div>
  )
}

function BulkActionButton({
  action,
  pending,
  destructive,
  onAction,
}: {
  action: DownloadTaskAction
  pending: boolean
  destructive?: boolean
  onAction: (action: DownloadTaskAction) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      className={cn(
        'h-7 gap-1.5 px-2 text-xs',
        destructive ? 'text-muted-foreground hover:text-destructive' : 'text-muted-foreground hover:text-foreground',
      )}
      onClick={() => onAction(action)}
    >
      <TaskActionIcon action={action} />
      {t(`downloads.actions.${action}`)}
    </Button>
  )
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function parseTagsInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function isReorderableColumn(columnId: string) {
  return columnId !== 'select' && columnId !== 'source'
}

function reorderColumn(columnOrder: ColumnOrderState, movingColumnId: string, targetColumnId: string) {
  const nextOrder = [...columnOrder]
  const movingIndex = nextOrder.indexOf(movingColumnId)
  const targetIndex = nextOrder.indexOf(targetColumnId)
  if (movingIndex < 0 || targetIndex < 0) return columnOrder
  nextOrder.splice(movingIndex, 1)
  nextOrder.splice(targetIndex, 0, movingColumnId)
  return nextOrder
}

function toDownloadTaskSortBy(columnId: string | undefined) {
  if (columnId === 'source') return 'source'
  if (columnId === 'category') return 'category'
  if (columnId === 'tags') return 'tags'
  if (columnId === 'status') return 'status'
  if (columnId === 'progress') return 'progress'
  if (columnId === 'eta') return 'eta'
  return 'createdAt'
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
  row,
  selected,
  actionPending,
  onSelect,
  onPrimaryAction,
  onAction,
}: {
  row: Row<DownloadTask>
  selected: boolean
  actionPending: boolean
  onSelect: () => void
  onPrimaryAction: () => void
  onAction: (action: DownloadTaskAction) => void
}) {
  const task = row.original

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          data-state={row.getIsSelected() ? 'selected' : undefined}
          className={cn('h-9 cursor-pointer hover:bg-muted/50', selected && 'bg-primary/5 hover:bg-primary/10')}
          onClick={onSelect}
          onContextMenu={onSelect}
          onDoubleClick={onPrimaryAction}
        >
          {row.getVisibleCells().map((cell) => (
            <TableCell key={cell.id} className={cn('py-1', cell.column.columnDef.meta?.className)}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
      </ContextMenuTrigger>
      <TaskContextMenu task={task} pending={actionPending} onAction={onAction} />
    </ContextMenu>
  )
}

function TaskContextMenu({
  task,
  pending,
  onAction,
}: {
  task: DownloadTask
  pending: boolean
  onAction: (action: DownloadTaskAction) => void
}) {
  const { t } = useTranslation()
  const actions = taskActions(task)
  const primaryAction = primaryTaskAction(task)

  return (
    <ContextMenuContent className="w-44">
      {actions.length === 0 && <ContextMenuItem disabled>{t('downloads.actions.none')}</ContextMenuItem>}
      {primaryAction && (
        <ContextMenuItem disabled={pending} onClick={() => onAction(primaryAction)}>
          <TaskActionIcon action={primaryAction} />
          {t(`downloads.actions.${primaryAction}`)}
        </ContextMenuItem>
      )}
      {actions
        .filter((action) => action !== primaryAction)
        .map((action, index) => (
          <TaskMenuItem
            key={action}
            action={action}
            pending={pending}
            separated={index === 0 && Boolean(primaryAction)}
            onAction={onAction}
          />
        ))}
    </ContextMenuContent>
  )
}

function TaskMenuItem({
  action,
  pending,
  separated,
  onAction,
}: {
  action: DownloadTaskAction
  pending: boolean
  separated: boolean
  onAction: (action: DownloadTaskAction) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      {separated && <ContextMenuSeparator />}
      <ContextMenuItem
        disabled={pending}
        variant={action === 'cancel' || action === 'delete' ? 'destructive' : 'default'}
        onClick={() => onAction(action)}
      >
        <TaskActionIcon action={action} />
        {t(`downloads.actions.${action}`)}
      </ContextMenuItem>
    </>
  )
}

function taskActions(task: DownloadTask): DownloadTaskAction[] {
  if (PAUSABLE_STATUSES.has(task.status)) return ['pause', 'cancel']
  if (task.status === 'paused') return ['resume', 'cancel']
  if (task.status === 'billing_paused' || task.status === 'uploading' || task.status === 'pausing') return ['cancel']
  if (task.status === 'failed' || task.status === 'canceled') return ['retry', 'delete']
  if (task.status === 'completed') return ['delete']
  return []
}

function availableBulkActions(tasks: DownloadTask[]): DownloadTaskAction[] {
  const orderedActions: DownloadTaskAction[] = ['pause', 'resume', 'cancel', 'retry', 'delete']
  return orderedActions.filter((action) => tasks.some((task) => taskActions(task).includes(action)))
}

function primaryTaskAction(task: DownloadTask): DownloadTaskAction | null {
  if (PAUSABLE_STATUSES.has(task.status)) return 'pause'
  if (task.status === 'paused') return 'resume'
  if (task.status === 'failed' || task.status === 'canceled') return 'retry'
  return null
}

function TaskActionIcon({ action }: { action: DownloadTaskAction }) {
  if (action === 'pause') return <PauseCircle />
  if (action === 'resume') return <PlayCircle />
  if (action === 'retry') return <RotateCcw />
  if (action === 'delete') return <Trash2 />
  return <XCircle />
}

function TransferProgress({ task, className }: { task: DownloadTask; className?: string }) {
  const progress = transferProgress(task)
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.overall}
    >
      <div className="absolute inset-y-0 left-0 bg-sky-500 transition-all" style={{ width: `${progress.download}%` }} />
      {progress.upload > 0 && (
        <div
          className="absolute right-0 bottom-0 left-0 h-0.5 bg-emerald-500/80 transition-all"
          style={{ width: `${progress.upload}%` }}
        />
      )}
    </div>
  )
}

function transferProgress(task: DownloadTask) {
  const total = Math.max(task.totalBytes ?? task.downloadedBytes, task.downloadedBytes, task.storageUploadedBytes, 0)
  if (total <= 0) return { download: 0, upload: 0, overall: task.status === 'completed' ? 100 : 0 }
  const download = Math.min(100, Math.round((task.downloadedBytes / total) * 100))
  const upload =
    task.status === 'completed' ? 100 : Math.min(100, Math.round((task.storageUploadedBytes / total) * 100))
  return { download, upload, overall: task.status === 'uploading' || upload > 0 ? upload : download }
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
  const progress = transferProgress(task)

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
          label={t('downloads.detail.storageUploadSpeed')}
          value={`${formatBytes(task.storageUploadBps)}/s`}
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

      <div className="space-y-1.5">
        <TransferProgress task={task} className="h-2" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
          <span>
            {t('downloads.detail.downloaded')}: {formatBytes(task.downloadedBytes)}
          </span>
          <span>
            {t('downloads.detail.storageUploaded')}: {formatBytes(task.storageUploadedBytes)}
          </span>
          <span>{progress.overall}%</span>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <InspectorField label={t('downloads.detail.progress')} value={`${progress.overall}%`} />
        <InspectorField label={t('downloads.detail.engine')} value={detail?.engine || t('downloads.unknown')} />
        <InspectorField label={t('downloads.detail.phase')} value={formatPhase(detail?.phase, t)} />
        <InspectorField label={t('downloads.detail.engineState')} value={detail?.engineState || '-'} />
        <InspectorField
          label={t('downloads.detail.target')}
          value={task.targetFolder || t('downloads.targetFolderRoot')}
        />
        <InspectorField label={t('downloads.detail.category')} value={task.category || '-'} />
        <InspectorField label={t('downloads.detail.tags')} value={task.tags.length ? task.tags.join(', ') : '-'} />
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
        <InspectorField
          label={t('downloads.detail.peerUploadSpeed')}
          value={`${formatBytes(detail?.peerUploadBps ?? 0)}/s`}
        />
        <InspectorField
          label={t('downloads.detail.peerUploaded')}
          value={formatBytes(detail?.peerUploadedBytes ?? 0)}
        />
        <InspectorField label={t('downloads.detail.storageUploaded')} value={formatBytes(task.storageUploadedBytes)} />
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

function displayStatus(task: DownloadTask): DownloadTaskDisplayStatus {
  if (task.status === 'completed' && task.detail?.phase === 'seeding') return 'seeding'
  return task.status
}

function StatusBadge({ status }: { status: DownloadTaskDisplayStatus }) {
  const { t } = useTranslation()
  const statusTone: Record<DownloadTaskDisplayStatus, { className: string; icon: ReactNode }> = {
    queued: {
      className:
        'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
      icon: <Clock />,
    },
    assigned: {
      className:
        'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
      icon: <RadioTower />,
    },
    running: {
      className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
      icon: <LoaderCircle className="animate-spin" />,
    },
    billing_paused: {
      className:
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
      icon: <PauseCircle />,
    },
    pausing: {
      className:
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
      icon: <LoaderCircle className="animate-spin" />,
    },
    paused: {
      className:
        'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
      icon: <PauseCircle />,
    },
    uploading: {
      className: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
      icon: <Upload />,
    },
    canceling: {
      className: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400',
      icon: <LoaderCircle className="animate-spin" />,
    },
    completed: {
      className:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
      icon: <CheckCircle2 />,
    },
    seeding: {
      className: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300',
      icon: <Users />,
    },
    failed: {
      className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
      icon: <XCircle />,
    },
    canceled: {
      className: 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400',
      icon: <Ban />,
    },
  }
  const tone = statusTone[status]
  return (
    <Badge variant="outline" className={cn('font-medium', tone.className)}>
      {tone.icon}
      {t(`downloads.status.${status}`)}
    </Badge>
  )
}

function formatPhase(phase: DownloadTaskPhase | undefined, t: ReturnType<typeof useTranslation>['t']) {
  if (!phase) return '-'
  return t(`downloads.phase.${phase}`)
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
