import { DirType } from '@shared/constants'
import type { DownloadTask, DownloadTaskAction, DownloadTaskStatus, StorageObject } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
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
  Check,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  Filter,
  Folder,
  FolderInput,
  Gauge,
  GripVertical,
  Home,
  LinkIcon,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createDownloadTask, downloadTaskEventsUrl, listDownloadTasks, runDownloadTaskAction } from '@/lib/api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authenticated/downloads/')({
  component: DownloadsPage,
})

const QUERY_KEY = ['download-tasks']
const EMPTY_DOWNLOAD_TASKS: DownloadTask[] = []
const PAUSABLE_STATUSES = new Set<DownloadTaskStatus>(['queued', 'assigned', 'downloading'])
const SORTABLE_COLUMN_IDS = new Set(['source', 'status', 'progress', 'eta', 'category', 'tags'])
const DEFAULT_COLUMN_ORDER = ['select', 'source', 'status', 'progress', 'eta', 'category', 'tags']
const STATUS_FILTERS: Array<{ value: DownloadTaskStatus | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'downloads.statusFilter.all' },
  { value: 'queued', labelKey: 'downloads.status.queued' },
  { value: 'downloading', labelKey: 'downloads.status.downloading' },
  { value: 'uploading', labelKey: 'downloads.status.uploading' },
  { value: 'suspended', labelKey: 'downloads.status.suspended' },
  { value: 'paused', labelKey: 'downloads.status.paused' },
  { value: 'interrupted', labelKey: 'downloads.status.interrupted' },
  { value: 'completed', labelKey: 'downloads.status.completed' },
  { value: 'failed', labelKey: 'downloads.status.failed' },
  { value: 'canceled', labelKey: 'downloads.status.canceled' },
]
type DownloadTaskDisplayStatus = DownloadTaskStatus | 'seeding'
type DownloadTaskPhase = NonNullable<NonNullable<DownloadTask['status']['runtime']>['phase']>
type DetailTab = 'overview' | 'trackers' | 'peers' | 'files' | 'log'
type PanelDragState = { startY: number; startDetailHeight: number; containerHeight: number }
type PendingTaskAction = { tasks: DownloadTask[]; action: DownloadTaskAction }
type DetailTableColumn<T> = {
  id: string
  label: ReactNode
  width: number
  minWidth?: number
  maxWidth?: number
  cellClassName?: string
  render: (row: T) => ReactNode
}

const LIST_MIN_HEIGHT = 180
const DETAIL_MIN_HEIGHT = 224
const DETAIL_DEFAULT_RATIO = 0.36
const PANEL_RESIZER_HEIGHT = 8
const DOWNLOAD_SELECT_COLUMN_WIDTH = 34
const DOWNLOAD_SOURCE_DEFAULT_WIDTH = 300
const DOWNLOAD_SOURCE_MIN_WIDTH = 180
const DOWNLOAD_STATUS_COLUMN_WIDTH = 124
const DOWNLOAD_COLUMN_WIDTHS = {
  source: DOWNLOAD_SOURCE_DEFAULT_WIDTH,
  status: DOWNLOAD_STATUS_COLUMN_WIDTH,
  category: 110,
  tags: 160,
  progress: 260,
  eta: 92,
} as const

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
  const [filterStatus, setFilterStatus] = useState<DownloadTaskStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(DEFAULT_COLUMN_ORDER)
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({})
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null)
  const [pendingTaskAction, setPendingTaskAction] = useState<PendingTaskAction | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [detailHeight, setDetailHeight] = useState(DETAIL_MIN_HEIGHT)
  const [detailHeightCustomized, setDetailHeightCustomized] = useState(false)
  const [panelDrag, setPanelDrag] = useState<PanelDragState | null>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  const tableFrameRef = useRef<HTMLElement>(null)
  const [tableFrameWidth, setTableFrameWidth] = useState(0)
  const categoryFilterValue = filterCategory.trim() || undefined
  const tagFilterValue = filterTag.trim() || undefined
  const statusFilterValue = filterStatus === 'all' ? undefined : filterStatus
  const sortBy = toDownloadTaskSortBy(sorting[0]?.id)
  const sortDir = sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : 'desc'
  const queryKey = useMemo(
    () =>
      [
        ...QUERY_KEY,
        statusFilterValue ?? '',
        categoryFilterValue ?? '',
        tagFilterValue ?? '',
        sortBy,
        sortDir,
      ] as const,
    [categoryFilterValue, sortBy, sortDir, statusFilterValue, tagFilterValue],
  )

  const tasksQuery = useQuery({
    queryKey,
    queryFn: () =>
      listDownloadTasks({
        page: 1,
        pageSize: 50,
        status: statusFilterValue,
        category: categoryFilterValue,
        tag: tagFilterValue,
        sortBy,
        sortDir,
      }),
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    const measuredContainer = panelsRef.current
    if (!measuredContainer) return

    function updateDetailHeight(container: HTMLDivElement) {
      const containerHeight = container.getBoundingClientRect().height
      if (detailHeightCustomized) {
        setDetailHeight((current) => clamp(current, DETAIL_MIN_HEIGHT, maxDetailHeight(containerHeight)))
        return
      }
      setDetailHeight(defaultDetailHeight(containerHeight))
    }

    updateDetailHeight(measuredContainer)
    const observer = new ResizeObserver(() => updateDetailHeight(measuredContainer))
    observer.observe(measuredContainer)
    return () => observer.disconnect()
  }, [detailHeightCustomized])

  useEffect(() => {
    const measuredFrame = tableFrameRef.current
    if (!measuredFrame) return

    function updateTableWidth(frame: HTMLElement) {
      setTableFrameWidth(frame.clientWidth)
    }

    updateTableWidth(measuredFrame)
    const observer = new ResizeObserver(() => updateTableWidth(measuredFrame))
    observer.observe(measuredFrame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const events = new EventSource(
      downloadTaskEventsUrl({
        status: statusFilterValue,
        category: categoryFilterValue,
        tag: tagFilterValue,
        sortBy,
        sortDir,
      }),
      {
        withCredentials: true,
      },
    )
    events.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data)
      queryClient.setQueryData(queryKey, data)
    })
    return () => events.close()
  }, [categoryFilterValue, queryClient, queryKey, sortBy, sortDir, statusFilterValue, tagFilterValue])

  useEffect(() => {
    if (!panelDrag) return
    const drag = panelDrag

    function handlePointerMove(event: PointerEvent) {
      setDetailHeight(
        clamp(
          drag.startDetailHeight - (event.clientY - drag.startY),
          DETAIL_MIN_HEIGHT,
          maxDetailHeight(drag.containerHeight),
        ),
      )
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

  const tasks = tasksQuery.data?.items ?? EMPTY_DOWNLOAD_TASKS
  const nonSourceTableWidth =
    DOWNLOAD_SELECT_COLUMN_WIDTH +
    downloadColumnWidth(columnSizing, 'status') +
    downloadColumnWidth(columnSizing, 'category') +
    downloadColumnWidth(columnSizing, 'tags') +
    downloadColumnWidth(columnSizing, 'progress') +
    downloadColumnWidth(columnSizing, 'eta')
  const sourceColumnWidth =
    columnSizing.source ?? Math.max(DOWNLOAD_SOURCE_DEFAULT_WIDTH, tableFrameWidth - nonSourceTableWidth)
  const downloadTableWidth = Math.max(tableFrameWidth, nonSourceTableWidth + sourceColumnWidth)
  const columns = useMemo(() => getDownloadColumns(t, sourceColumnWidth), [sourceColumnWidth, t])
  const table = useReactTable({
    data: tasks,
    columns,
    defaultColumn: { enableSorting: false, minSize: 72, maxSize: 520 },
    state: { rowSelection, columnOrder, columnSizing },
    onRowSelectionChange: setRowSelection,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (task) => task.id,
    enableRowSelection: true,
    columnResizeMode: 'onChange',
  })
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null
  const activeSelectedTaskId = selectedTask?.id ?? null
  const selectedTasks = table.getSelectedRowModel().rows.map((row) => row.original)

  function handleSortColumn(columnId: string) {
    if (!SORTABLE_COLUMN_IDS.has(columnId)) return
    setSorting((current) => {
      const active = current[0]
      if (active?.id !== columnId) return [{ id: columnId, desc: false }]
      if (!active.desc) return [{ id: columnId, desc: true }]
      return []
    })
  }

  function handlePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const containerHeight = panelsRef.current?.getBoundingClientRect().height ?? 0
    setDetailHeightCustomized(true)
    setPanelDrag({ startY: event.clientY, startDetailHeight: detailHeight, containerHeight })
  }

  function handlePanelResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const containerHeight = panelsRef.current?.getBoundingClientRect().height ?? 0
    setDetailHeightCustomized(true)
    setDetailHeight((current) =>
      clamp(current + (event.key === 'ArrowUp' ? 24 : -24), DETAIL_MIN_HEIGHT, maxDetailHeight(containerHeight)),
    )
  }

  return (
    <div className="flex h-[calc(100svh-5.5rem)] flex-col gap-2 overflow-hidden">
      <PageHeader
        items={[{ label: t('downloads.title'), icon: <Download className="size-4 text-muted-foreground" /> }]}
        actions={
          <div className="flex min-w-0 items-center gap-2">
            {selectedTasks.length > 0 && (
              <BulkTaskActions
                tasks={selectedTasks}
                pending={actionMutation.isPending}
                onAction={handleBulkAction}
                onClear={() => setRowSelection({})}
              />
            )}
            <DownloadFilters
              status={filterStatus}
              category={filterCategory}
              tag={filterTag}
              onStatusChange={setFilterStatus}
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
        <section ref={tableFrameRef} className="min-h-0 overflow-hidden rounded-md border bg-background">
          <Table
            containerClassName="h-full overflow-auto"
            className="table-fixed text-xs"
            style={{ width: downloadTableWidth }}
          >
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <DownloadTableHead
                      key={header.id}
                      header={header}
                      sorting={sorting}
                      draggedColumnId={draggedColumnId}
                      onSort={handleSortColumn}
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
                  <TableCell colSpan={table.getAllColumns().length} className="h-28 text-center text-muted-foreground">
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
  status,
  category,
  tag,
  onStatusChange,
  onCategoryChange,
  onTagChange,
}: {
  status: DownloadTaskStatus | 'all'
  category: string
  tag: string
  onStatusChange: (value: DownloadTaskStatus | 'all') => void
  onCategoryChange: (value: string) => void
  onTagChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const active = status !== 'all' || Boolean(category || tag)

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
          <Label htmlFor="download-filter-status" className="text-xs">
            {t('downloads.table.status')}
          </Label>
          <Select value={status} onValueChange={(value) => onStatusChange(value as DownloadTaskStatus | 'all')}>
            <SelectTrigger id="download-filter-status" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="z-[70]">
              {STATUS_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {t(item.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              onStatusChange('all')
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
  sorting,
  draggedColumnId,
  onSort,
  onDragStart,
  onDrop,
}: {
  header: Header<DownloadTask, unknown>
  sorting: SortingState
  draggedColumnId: string | null
  onSort: (columnId: string) => void
  onDragStart: (columnId: string | null) => void
  onDrop: (columnId: string) => void
}) {
  const reorderable = isReorderableColumn(header.column.id)

  function handleDrop(event: ReactDragEvent<HTMLTableCellElement>) {
    event.preventDefault()
    onDrop(header.column.id)
  }

  const canSort = SORTABLE_COLUMN_IDS.has(header.column.id)
  const canResize = header.column.getCanResize()
  const activeSort = sorting[0]?.id === header.column.id ? (sorting[0].desc ? 'desc' : 'asc') : false

  return (
    <TableHead
      className={cn(
        'sticky top-0 z-20 h-8 overflow-hidden bg-muted px-2',
        header.column.columnDef.meta?.className,
        canSort && 'select-none',
        draggedColumnId === header.column.id && 'opacity-50',
      )}
      style={{ width: header.column.getSize() }}
      onDragOver={(event) => {
        if (reorderable && draggedColumnId) event.preventDefault()
      }}
      onDrop={handleDrop}
      onDragEnd={() => onDragStart(null)}
    >
      <div className="flex min-w-0 items-center gap-1">
        {canSort ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
            onClick={() => onSort(header.column.id)}
          >
            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
            <SortIndicator direction={activeSort} />
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            {flexRender(header.column.columnDef.header, header.getContext())}
          </span>
        )}
        {reorderable && (
          <button
            type="button"
            draggable
            className="flex size-4 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              onDragStart(header.column.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => onDragStart(null)}
          >
            <GripVertical className="size-3" />
          </button>
        )}
      </div>
      {canResize && (
        <button
          type="button"
          aria-label="Resize column"
          className="absolute top-1 right-0 bottom-1 w-1 cursor-col-resize rounded-full bg-transparent hover:bg-primary/40 active:bg-primary/50"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
        />
      )}
    </TableHead>
  )
}

function getDownloadColumns(
  t: ReturnType<typeof useTranslation>['t'],
  sourceColumnWidth: number,
): ColumnDef<DownloadTask>[] {
  return [
    {
      id: 'select',
      size: DOWNLOAD_SELECT_COLUMN_WIDTH,
      minSize: DOWNLOAD_SELECT_COLUMN_WIDTH,
      maxSize: DOWNLOAD_SELECT_COLUMN_WIDTH,
      enableSorting: false,
      enableResizing: false,
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
      accessorFn: (task) => `${getTaskTitle(task)} ${sourceUri(task)}`,
      header: () => t('downloads.table.source'),
      size: sourceColumnWidth,
      minSize: DOWNLOAD_SOURCE_MIN_WIDTH,
      maxSize: 1600,
      cell: ({ row }) => (
        <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden">
          <SourceIcon type={sourceType(row.original)} />
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="truncate text-xs font-medium">{getTaskTitle(row.original)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{sourceUri(row.original)}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      accessorFn: (task) => task.spec.labels.category ?? '',
      header: () => t('downloads.table.category'),
      size: DOWNLOAD_COLUMN_WIDTHS.category,
      minSize: 86,
      maxSize: 240,
      cell: ({ row }) => <CategoryCell category={row.original.spec.labels.category} />,
    },
    {
      id: 'tags',
      accessorFn: (task) => task.spec.labels.tags.join(' / '),
      header: () => t('downloads.table.tags'),
      size: DOWNLOAD_COLUMN_WIDTHS.tags,
      minSize: 100,
      maxSize: 360,
      cell: ({ row }) => <TagsCell tags={row.original.spec.labels.tags} />,
    },
    {
      id: 'status',
      accessorFn: (task) => displayStatus(task),
      header: () => t('downloads.table.status'),
      size: DOWNLOAD_STATUS_COLUMN_WIDTH,
      minSize: 90,
      maxSize: 180,
      cell: ({ row }) => <StatusCell status={displayStatus(row.original)} />,
    },
    {
      id: 'progress',
      accessorFn: (task) => transferProgress(task).overall,
      header: () => t('downloads.table.progress'),
      size: DOWNLOAD_COLUMN_WIDTHS.progress,
      cell: ({ row }) => <ProgressCell task={row.original} />,
    },
    {
      id: 'eta',
      accessorFn: (task) => task.status.runtime?.etaSeconds ?? Number.MAX_SAFE_INTEGER,
      header: () => t('downloads.table.eta'),
      size: DOWNLOAD_COLUMN_WIDTHS.eta,
      cell: ({ row }) => (
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatDuration(row.original.status.runtime?.etaSeconds)}
        </span>
      ),
    },
  ]
}

function CategoryCell({ category }: { category: string | null }) {
  if (!category) return <span className="text-xs text-muted-foreground">-</span>
  return <span className="block min-w-0 truncate text-xs text-muted-foreground">{category}</span>
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">-</span>
  return <span className="block min-w-0 truncate text-xs text-muted-foreground">{tags.join(' / ')}</span>
}

function ProgressCell({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const progress = transferProgress(task)
  const activeTransfer = currentTransferProgress(task)
  const sizeText = `${formatBytes(activeTransfer.bytes)} / ${activeTransfer.totalBytes ? formatBytes(activeTransfer.totalBytes) : t('downloads.unknown')}`

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2">
        <TransferProgress task={task} className="h-1.5 flex-1" />
        <span className="w-9 shrink-0 text-right text-[11px] font-medium tabular-nums">{progress.overall}%</span>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span className="truncate">{sizeText}</span>
        <span className="whitespace-nowrap">
          <span className="text-foreground/80">{formatBytes(task.status.progress.download.bytesPerSecond)}/s</span>
          <span className="mx-1 text-muted-foreground/70">↓</span>
          <span>{formatBytes(task.status.progress.upload.bytesPerSecond)}/s</span>
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

function maxDetailHeight(containerHeight: number) {
  return Math.max(DETAIL_MIN_HEIGHT, containerHeight - PANEL_RESIZER_HEIGHT - LIST_MIN_HEIGHT)
}

function defaultDetailHeight(containerHeight: number) {
  return clamp(Math.round(containerHeight * DETAIL_DEFAULT_RATIO), DETAIL_MIN_HEIGHT, maxDetailHeight(containerHeight))
}

function downloadColumnWidth(
  columnSizing: ColumnSizingState,
  columnId: Exclude<keyof typeof DOWNLOAD_COLUMN_WIDTHS, 'source'>,
) {
  return columnSizing[columnId] ?? DOWNLOAD_COLUMN_WIDTHS[columnId]
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
            <TableCell
              key={cell.id}
              className={cn('py-1', cell.column.columnDef.meta?.className)}
              style={{ width: cell.column.getSize() }}
            >
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
  if (PAUSABLE_STATUSES.has(task.status.state)) return ['pause', 'cancel']
  if (task.status.state === 'paused') return ['resume', 'restart', 'cancel']
  if (task.status.state === 'suspended') return ['resume', 'restart', 'cancel']
  if (task.status.state === 'interrupted') return ['restart', 'cancel']
  if (task.status.state === 'uploading' || task.status.state === 'pausing') return ['cancel']
  if (task.status.state === 'failed') return ['retry', 'restart', 'delete']
  if (task.status.state === 'canceled') return ['restart', 'delete']
  if (task.status.state === 'completed') return ['restart', 'delete']
  return []
}

function availableBulkActions(tasks: DownloadTask[]): DownloadTaskAction[] {
  const orderedActions: DownloadTaskAction[] = ['pause', 'resume', 'cancel', 'retry', 'restart', 'delete']
  return orderedActions.filter((action) => tasks.some((task) => taskActions(task).includes(action)))
}

function primaryTaskAction(task: DownloadTask): DownloadTaskAction | null {
  if (PAUSABLE_STATUSES.has(task.status.state)) return 'pause'
  if (task.status.state === 'paused' || task.status.state === 'suspended') return 'resume'
  if (task.status.state === 'interrupted') return 'restart'
  if (task.status.state === 'failed' || task.status.state === 'canceled') return 'retry'
  return null
}

function TaskActionIcon({ action }: { action: DownloadTaskAction }) {
  if (action === 'pause') return <PauseCircle />
  if (action === 'resume') return <PlayCircle />
  if (action === 'retry') return <RotateCcw />
  if (action === 'restart') return <RotateCcw />
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
          className="absolute inset-y-0 left-0 bg-emerald-500 transition-all"
          style={{ width: `${progress.upload}%` }}
        />
      )}
    </div>
  )
}

function transferProgress(task: DownloadTask) {
  const download = transferPercent(task.status.progress.download, task.status.state === 'completed')
  const upload = transferPercent(task.status.progress.upload, task.status.state === 'completed')
  return { download, upload, overall: task.status.state === 'uploading' || upload > 0 ? upload : download }
}

function currentTransferProgress(task: DownloadTask) {
  return task.status.state === 'uploading' ? task.status.progress.upload : task.status.progress.download
}

function transferPercent(progress: DownloadTask['status']['progress']['download'], complete: boolean) {
  if (complete) return 100
  if (!progress.totalBytes || progress.totalBytes <= 0) return 0
  return Math.min(100, Math.round((progress.bytes / progress.totalBytes) * 100))
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
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-muted-foreground">
        {t('downloads.detail.noSelection')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
  const detail = task.status.runtime
  const progress = transferProgress(task)
  const activeTransfer = currentTransferProgress(task)

  return (
    <div className="space-y-3">
      <TaskErrorNotice task={task} />

      <div className="grid gap-2 md:grid-cols-4">
        <InspectorMetric
          icon={<Gauge className="size-4" />}
          label={t('downloads.detail.downloadSpeed')}
          value={`${formatBytes(task.status.progress.download.bytesPerSecond)}/s`}
        />
        <InspectorMetric
          icon={<Upload className="size-4" />}
          label={t('downloads.detail.storageUploadSpeed')}
          value={`${formatBytes(task.status.progress.upload.bytesPerSecond)}/s`}
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
            {t('downloads.detail.downloaded')}: {formatBytes(task.status.progress.download.bytes)}
          </span>
          <span>
            {t('downloads.detail.storageUploaded')}: {formatBytes(task.status.progress.upload.bytes)}
          </span>
          <span>{progress.overall}%</span>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <InspectorField label={t('downloads.detail.progress')} value={`${progress.overall}%`} />
        <InspectorField label={t('downloads.detail.engine')} value={detail?.engine || t('downloads.unknown')} />
        <InspectorField label={t('downloads.detail.phase')} value={formatPhase(detail?.phase, t)} />
        <InspectorField label={t('downloads.detail.engineState')} value={detail?.state || '-'} />
        <InspectorField
          label={t('downloads.detail.target')}
          value={task.spec.destination.folder || t('downloads.targetFolderRoot')}
        />
        <InspectorField label={t('downloads.detail.category')} value={task.spec.labels.category || '-'} />
        <InspectorField
          label={t('downloads.detail.tags')}
          value={task.spec.labels.tags.length ? task.spec.labels.tags.join(', ') : '-'}
        />
        <InspectorField
          label={t('downloads.detail.sourceType')}
          value={t(`downloads.sourceTypes.${sourceTypeKey(task)}`)}
        />
        <InspectorField label={t('downloads.detail.source')} value={sourceUri(task)} />
        <InspectorField
          label={t('downloads.detail.size')}
          value={`${formatBytes(activeTransfer.bytes)} / ${activeTransfer.totalBytes ? formatBytes(activeTransfer.totalBytes) : t('downloads.unknown')}`}
        />
        <InspectorField
          label={t('downloads.detail.billing')}
          value={`${formatBytes(task.status.billing.chargedBytes)} / ${task.status.billing.chargedCredits} credits`}
        />
        <InspectorField label={t('downloads.detail.infoHash')} value={detail?.torrent?.infoHash || '-'} />
        <InspectorField label={t('downloads.detail.torrentName')} value={detail?.torrent?.name || '-'} />
        <InspectorField label={t('downloads.detail.seeders')} value={formatNumber(detail?.torrent?.seeders)} />
        <InspectorField label={t('downloads.detail.leechers')} value={formatNumber(detail?.torrent?.leechers)} />
        <InspectorField
          label={t('downloads.detail.peerUploadSpeed')}
          value={`${formatBytes(detail?.seeding?.uploadBytesPerSecond ?? 0)}/s`}
        />
        <InspectorField
          label={t('downloads.detail.peerUploaded')}
          value={formatBytes(detail?.seeding?.uploadedBytes ?? 0)}
        />
        <InspectorField
          label={t('downloads.detail.storageUploaded')}
          value={formatBytes(task.status.progress.upload.bytes)}
        />
        <InspectorField label={t('downloads.detail.createdAt')} value={formatDate(task.createdAt)} />
        <InspectorField label={t('downloads.detail.startedAt')} value={formatDate(task.status.startedAt)} />
        <InspectorField label={t('downloads.detail.finishedAt')} value={formatDate(task.status.finishedAt)} />
      </div>
    </div>
  )
}

function TaskErrorNotice({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const detail = task.status.runtime
  const messages = [task.status.error?.message, detail?.message].filter(Boolean) as string[]
  if (messages.length === 0) return null

  return (
    <div className="flex gap-3 rounded-sm border border-destructive/35 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide">{t('downloads.detail.errorMessage')}</div>
        <div className="space-y-1 break-words text-foreground">
          {messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TrackersPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const trackers = task.status.runtime?.trackers ?? []

  if (trackers.length === 0) return <EmptyPanel text={t('downloads.detail.noTrackers')} />

  const columns: Array<DetailTableColumn<(typeof trackers)[number]>> = [
    {
      id: 'url',
      label: t('downloads.detail.trackerUrl'),
      width: 420,
      minWidth: 180,
      maxWidth: 900,
      cellClassName: 'truncate font-mono text-xs',
      render: (tracker) => tracker.url,
    },
    {
      id: 'status',
      label: t('downloads.detail.trackerStatus'),
      width: 130,
      minWidth: 90,
      maxWidth: 220,
      render: (tracker) => tracker.status || '-',
    },
    {
      id: 'seeds',
      label: t('downloads.detail.seeders'),
      width: 86,
      minWidth: 72,
      maxWidth: 140,
      cellClassName: 'tabular-nums',
      render: (tracker) => formatNumber(tracker.seeds),
    },
    {
      id: 'peers',
      label: t('downloads.detail.peers'),
      width: 86,
      minWidth: 72,
      maxWidth: 140,
      cellClassName: 'tabular-nums',
      render: (tracker) => formatNumber(tracker.peers),
    },
    {
      id: 'message',
      label: t('downloads.detail.statusMessage'),
      width: 280,
      minWidth: 140,
      maxWidth: 700,
      cellClassName: 'truncate text-muted-foreground',
      render: (tracker) => tracker.message || '-',
    },
  ]

  return <ResizableDetailTable columns={columns} rows={trackers} rowKey={(tracker) => tracker.url} />
}

function PeersPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const peers = task.status.runtime?.peers ?? []

  if (peers.length === 0) return <EmptyPanel text={t('downloads.detail.noPeers')} />

  const columns: Array<DetailTableColumn<(typeof peers)[number]>> = [
    {
      id: 'address',
      label: t('downloads.detail.peerAddress'),
      width: 230,
      minWidth: 160,
      maxWidth: 430,
      render: (peer) => (
        <div className="flex min-w-0 items-center gap-2">
          <PeerRegionMark countryCode={peer.countryCode} regionCode={peer.regionCode} />
          <span className="min-w-0 truncate font-mono text-xs">{peer.address}</span>
        </div>
      ),
    },
    {
      id: 'client',
      label: t('downloads.detail.peerClient'),
      width: 240,
      minWidth: 120,
      maxWidth: 560,
      cellClassName: 'truncate',
      render: (peer) => peer.client || '-',
    },
    {
      id: 'progress',
      label: t('downloads.detail.progress'),
      width: 100,
      minWidth: 82,
      maxWidth: 160,
      cellClassName: 'tabular-nums',
      render: (peer) => formatPercent(peer.progress),
    },
    {
      id: 'download',
      label: t('downloads.detail.downloadSpeed'),
      width: 130,
      minWidth: 108,
      maxWidth: 220,
      cellClassName: 'tabular-nums',
      render: (peer) => `${formatBytes(peer.downloadBps ?? 0)}/s`,
    },
    {
      id: 'upload',
      label: t('downloads.detail.uploadSpeed'),
      width: 130,
      minWidth: 108,
      maxWidth: 220,
      cellClassName: 'tabular-nums',
      render: (peer) => `${formatBytes(peer.uploadBps ?? 0)}/s`,
    },
  ]

  return <ResizableDetailTable columns={columns} rows={peers} rowKey={(peer) => peer.address} />
}

function FilesPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const files = task.status.runtime?.files ?? []

  if (files.length === 0) return <EmptyPanel text={t('downloads.detail.noFiles')} />

  const columns: Array<DetailTableColumn<(typeof files)[number]>> = [
    {
      id: 'path',
      label: t('downloads.detail.filePath'),
      width: 430,
      minWidth: 180,
      maxWidth: 1000,
      cellClassName: 'truncate',
      render: (file) => file.path,
    },
    {
      id: 'progress',
      label: t('downloads.detail.progress'),
      width: 220,
      minWidth: 160,
      maxWidth: 360,
      render: (file) => {
        const progress = file.size > 0 ? Math.min(100, Math.round(((file.completedBytes ?? 0) / file.size) * 100)) : 0
        return (
          <div className="flex items-center gap-2">
            <Progress value={progress} className="h-1.5" />
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
          </div>
        )
      },
    },
    {
      id: 'size',
      label: t('downloads.detail.size'),
      width: 170,
      minWidth: 120,
      maxWidth: 260,
      cellClassName: 'tabular-nums text-muted-foreground',
      render: (file) => `${formatBytes(file.completedBytes ?? 0)} / ${formatBytes(file.size)}`,
    },
    {
      id: 'status',
      label: t('downloads.detail.fileStatus'),
      width: 120,
      minWidth: 90,
      maxWidth: 180,
      render: (file) => (file.selected === false ? t('downloads.detail.skipped') : t('downloads.detail.selected')),
    },
  ]

  return <ResizableDetailTable columns={columns} rows={files} rowKey={(file) => file.path} />
}

function ResizableDetailTable<T>({
  columns,
  rows,
  rowKey,
}: {
  columns: Array<DetailTableColumn<T>>
  rows: T[]
  rowKey: (row: T) => string
}) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((column) => [column.id, column.width])),
  )
  const totalWidth = columns.reduce((sum, column) => sum + (columnWidths[column.id] ?? column.width), 0)

  function handleResizeStart(column: DetailTableColumn<T>, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnWidths[column.id] ?? column.width
    const minWidth = column.minWidth ?? 72
    const maxWidth = column.maxWidth ?? 1200

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = clamp(startWidth + moveEvent.clientX - startX, minWidth, maxWidth)
      setColumnWidths((current) => ({ ...current, [column.id]: nextWidth }))
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
  }

  return (
    <Table className="table-fixed text-xs" style={{ width: `max(100%, ${totalWidth}px)` }}>
      <colgroup>
        {columns.map((column) => (
          <col key={column.id} style={{ width: columnWidths[column.id] ?? column.width }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.id} className="relative h-8 overflow-hidden pr-4">
              <span className="block truncate">{column.label}</span>
              <button
                type="button"
                aria-label="Resize column"
                className="absolute top-1 right-0 bottom-1 w-1 cursor-col-resize rounded-full bg-transparent hover:bg-primary/40 active:bg-primary/50"
                onPointerDown={(event) => handleResizeStart(column, event)}
              />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) => (
              <TableCell key={column.id} className={cn('overflow-hidden', column.cellClassName)}>
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PeerRegionMark({ countryCode, regionCode }: { countryCode?: string; regionCode?: string }) {
  const country = normalizeRegionCode(countryCode)
  const region = normalizeRegionCode(regionCode)
  if (!country) return null

  const countryName = country ? formatRegionDisplayName(country) : null
  const regionName = region && region !== country ? formatSubdivisionDisplayName(country, region) : null
  const flag = countryCodeToFlag(country)
  if (!flag) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center text-[15px] leading-none"
          role="img"
          aria-label={[countryName ?? country, regionName ?? region].filter(Boolean).join(', ')}
        >
          {flag}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" className="max-w-64">
        <div className="space-y-0.5">
          <div className="font-medium">{countryName ?? country}</div>
          {region && region !== country && (
            <div className="text-background/75">{regionName ? `${regionName} (${region})` : region}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function normalizeRegionCode(value: string | undefined) {
  const normalized = value?.trim().toUpperCase()
  return normalized || null
}

function formatRegionDisplayName(regionCode: string) {
  if (typeof Intl.DisplayNames !== 'function') return null
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(regionCode) ?? null
  } catch {
    return null
  }
}

function formatSubdivisionDisplayName(countryCode: string, regionCode: string) {
  if (typeof Intl.DisplayNames !== 'function') return null
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(`${countryCode}-${regionCode}`) ?? null
  } catch {
    return null
  }
}

function countryCodeToFlag(countryCode: string) {
  if (!/^[A-Z]{2}$/.test(countryCode)) return null
  const regionalIndicatorOffset = 127397
  return String.fromCodePoint(...[...countryCode].map((char) => char.charCodeAt(0) + regionalIndicatorOffset))
}

function LogPanel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation()
  const detail = task.status.runtime
  const events = [
    {
      id: 'created',
      tone: 'neutral',
      time: formatDate(task.createdAt),
      title: t('downloads.detail.createdAt'),
      detail: sourceUri(task),
    },
    task.status.startedAt && {
      id: 'started',
      tone: 'active',
      time: formatDate(task.status.startedAt),
      title: t('downloads.detail.startedAt'),
      detail: [detail?.engine, formatPhase(detail?.phase, t)].filter(Boolean).join(' · '),
    },
    detail?.message && {
      id: 'runtime-message',
      tone: 'warning',
      time: formatDate(detail.updatedAt),
      title: t('downloads.detail.statusMessage'),
      detail: detail.message,
    },
    task.status.error?.message && {
      id: 'error',
      tone: 'error',
      time: formatDate(task.status.updatedAt),
      title: t('downloads.detail.errorMessage'),
      detail: task.status.error.message,
    },
    task.status.finishedAt && {
      id: 'finished',
      tone: task.status.state === 'completed' ? 'success' : 'neutral',
      time: formatDate(task.status.finishedAt),
      title: t('downloads.detail.finishedAt'),
      detail: t(`downloads.status.${task.status.state}`),
    },
  ].filter(Boolean) as Array<{
    id: string
    tone: 'active' | 'error' | 'neutral' | 'success' | 'warning'
    time: string
    title: string
    detail: string
  }>

  const timelineEvents = [...events].reverse()

  return (
    <div className="space-y-0 text-xs">
      {timelineEvents.map((event, index) => (
        <div key={event.id} className="grid grid-cols-[1.25rem_1fr] gap-2">
          <div className="relative flex justify-center">
            <span className={cn('mt-1.5 size-2 rounded-full', logEventDotClass(event.tone))} />
            {index < timelineEvents.length - 1 && <span className="absolute top-4 bottom-0 w-px bg-border" />}
          </div>
          <div className="min-w-0 pb-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{event.title}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{event.time}</span>
            </div>
            {event.detail && <div className="mt-0.5 break-words text-muted-foreground">{event.detail}</div>}
          </div>
        </div>
      ))}
      {events.length === 0 && <EmptyPanel text={t('downloads.detail.noLog')} />}
    </div>
  )
}

function logEventDotClass(tone: 'active' | 'error' | 'neutral' | 'success' | 'warning') {
  if (tone === 'active') return 'bg-sky-500'
  if (tone === 'error') return 'bg-destructive'
  if (tone === 'success') return 'bg-emerald-500'
  if (tone === 'warning') return 'bg-amber-500'
  return 'bg-muted-foreground/50'
}

function SourceIcon({ type }: { type: DownloadTask['spec']['source']['type'] }) {
  if (type === 'magnet') return <Magnet className="size-4 shrink-0 text-amber-500" />
  if (type === 'torrent_url') return <FileDown className="size-4 shrink-0 text-violet-500" />
  return <LinkIcon className="size-4 shrink-0 text-blue-500" />
}

function sourceType(task: DownloadTask): DownloadTask['spec']['source']['type'] {
  return task.spec.source.type
}

function sourceUri(task: DownloadTask): string {
  return task.spec.source.uri
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
  return (
    task.status.runtime?.torrent?.name ||
    task.spec.destination.name ||
    filenameFromUri(sourceUri(task)) ||
    sourceUri(task)
  )
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
  if (sourceType(task) === 'torrent_url') return 'torrentUrl'
  return sourceType(task)
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
  if (task.status.state === 'completed' && task.status.runtime?.phase === 'seeding') return 'seeding'
  return task.status.state
}

function StatusCell({ status }: { status: DownloadTaskDisplayStatus }) {
  const { t } = useTranslation()
  const statusTone: Record<DownloadTaskDisplayStatus, { className: string; dotClassName: string; active?: boolean }> = {
    queued: {
      className: 'text-slate-700 dark:text-slate-300',
      dotClassName: 'bg-slate-400',
    },
    assigned: {
      className: 'text-indigo-700 dark:text-indigo-300',
      dotClassName: 'bg-indigo-500',
    },
    downloading: {
      className: 'text-blue-700 dark:text-blue-300',
      dotClassName: 'bg-blue-500',
      active: true,
    },
    suspended: {
      className: 'text-amber-800 dark:text-amber-300',
      dotClassName: 'bg-amber-500',
    },
    pausing: {
      className: 'text-amber-800 dark:text-amber-300',
      dotClassName: 'bg-amber-500',
      active: true,
    },
    paused: {
      className: 'text-orange-700 dark:text-orange-300',
      dotClassName: 'bg-orange-500',
    },
    interrupted: {
      className: 'text-yellow-800 dark:text-yellow-300',
      dotClassName: 'bg-yellow-500',
    },
    uploading: {
      className: 'text-teal-700 dark:text-teal-300',
      dotClassName: 'bg-teal-500',
      active: true,
    },
    canceling: {
      className: 'text-zinc-600 dark:text-zinc-400',
      dotClassName: 'bg-zinc-400',
      active: true,
    },
    completed: {
      className: 'text-emerald-700 dark:text-emerald-300',
      dotClassName: 'bg-emerald-500',
    },
    seeding: {
      className: 'text-cyan-700 dark:text-cyan-300',
      dotClassName: 'bg-cyan-500',
      active: true,
    },
    failed: {
      className: 'text-rose-700 dark:text-rose-300',
      dotClassName: 'bg-rose-500',
    },
    canceled: {
      className: 'text-zinc-600 dark:text-zinc-400',
      dotClassName: 'bg-zinc-400',
    },
  }
  const tone = statusTone[status]
  return (
    <span
      className={cn('inline-grid grid-cols-[0.5rem_11ch] items-center gap-2 text-[11px] font-medium', tone.className)}
    >
      <span
        className={cn('size-1.5 rounded-full', tone.dotClassName, tone.active && 'animate-pulse')}
        aria-hidden="true"
      />
      <span className="truncate text-left">{t(`downloads.status.${status}`)}</span>
    </span>
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
