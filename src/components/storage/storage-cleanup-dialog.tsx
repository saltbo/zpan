import { STORAGE_USAGE_CATEGORIES } from '@shared/storage-usage'
import type {
  StorageUsageBreakdown,
  StorageUsageCategory,
  StorageUsageItem,
  StorageUsageSortDirection,
  StorageUsageSortField,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  File,
  FileText,
  Image,
  Images,
  Loader2,
  Music,
  Trash2,
  Video,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { deleteIhostImage, deleteObject, listStorageUsageItems, purgeTrashObject } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'
import { runSequentialOperation, type SequentialOperationFailure } from '@/lib/sequential-operation'
import { cn } from '@/lib/utils'

export const STORAGE_CATEGORY_META: Record<StorageUsageCategory, { color: string; icon: typeof Image }> = {
  photos: { color: '#f59e42', icon: Image },
  videos: { color: '#7c5ce7', icon: Video },
  music: { color: '#ec4899', icon: Music },
  documents: { color: '#3b82f6', icon: FileText },
  archives: { color: '#14b8a6', icon: Archive },
  other: { color: '#94a3b8', icon: File },
  image_hosting: { color: '#06b6d4', icon: Images },
  trash: { color: '#ef4444', icon: Trash2 },
}

const PAGE_SIZE = 20
const SKELETON_ROWS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'] as const

export function StorageCleanupDialog({
  category,
  breakdowns,
  onCategoryChange,
  onOpenChange,
}: {
  category: StorageUsageCategory | null
  breakdowns: StorageUsageBreakdown[]
  onCategoryChange: (category: StorageUsageCategory) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<StorageUsageSortField>('size')
  const [sortDir, setSortDir] = useState<StorageUsageSortDirection>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingDeleteItems, setPendingDeleteItems] = useState<StorageUsageItem[]>([])
  const [deleteProgress, setDeleteProgress] = useState({ completed: 0, total: 0 })
  const [deleteErrors, setDeleteErrors] = useState<Array<SequentialOperationFailure<StorageUsageItem>>>([])

  const itemsQuery = useQuery({
    queryKey: ['storage-usage', 'items', category, page, PAGE_SIZE, sortBy, sortDir],
    queryFn: () => listStorageUsageItems(category!, page, PAGE_SIZE, sortBy, sortDir),
    enabled: category !== null,
  })
  const items = itemsQuery.data?.items ?? []
  const total = itemsQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeBreakdown = breakdowns.find((row) => row.category === category)
  const selectedItems = useMemo(() => items.filter((item) => selectedIds.has(item.id)), [items, selectedIds])
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.size, 0)
  const allVisibleSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id))
  const someVisibleSelected = items.some((item) => selectedIds.has(item.id))

  const deleteMutation = useMutation({
    mutationFn: async (targets: StorageUsageItem[]) => {
      setDeleteErrors([])
      setDeleteProgress({ completed: 0, total: targets.length })
      return runSequentialOperation({
        items: targets,
        runItem: deleteStorageUsageItem,
        onItemComplete: (_item, index) => setDeleteProgress({ completed: index + 1, total: targets.length }),
        onItemFailure: (_item, _error, index) => setDeleteProgress({ completed: index + 1, total: targets.length }),
      })
    },
    onSuccess: async (result, targets) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['storage-usage'] }),
        queryClient.invalidateQueries({ queryKey: ['user', 'quota'] }),
        queryClient.invalidateQueries({ queryKey: ['objects'] }),
        queryClient.invalidateQueries({ queryKey: ['ihost'] }),
      ])
      setPage(1)
      if (result.failed.length > 0) {
        setDeleteErrors(result.failed)
        setPendingDeleteItems(result.failed.map((failure) => failure.item))
        setSelectedIds(new Set(result.failed.map((failure) => failure.item.id)))
        toast.error(t('storage.deletePartial', { failed: result.failed.length, total: targets.length }))
        return
      }
      const deletedBytes = targets.reduce((sum, item) => sum + item.size, 0)
      setPendingDeleteItems([])
      setSelectedIds(new Set())
      toast.success(t('storage.deleteSuccess', { count: targets.length, size: formatSize(deletedBytes) }))
    },
  })

  function resetSelection() {
    setSelectedIds(new Set())
    setPendingDeleteItems([])
    setDeleteErrors([])
  }

  function changeCategory(nextCategory: StorageUsageCategory) {
    setPage(1)
    resetSelection()
    onCategoryChange(nextCategory)
  }

  function changePage(nextPage: number) {
    setPage(nextPage)
    setSelectedIds(new Set())
  }

  function changeSort(field: StorageUsageSortField) {
    const nextDirection = sortBy === field ? (sortDir === 'asc' ? 'desc' : 'asc') : field === 'name' ? 'asc' : 'desc'
    setSortBy(field)
    setSortDir(nextDirection)
    setPage(1)
    setSelectedIds(new Set())
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleOpenChange(open: boolean) {
    if (!open && !deleteMutation.isPending) {
      setPage(1)
      resetSelection()
      onOpenChange(false)
    }
  }

  const activeMeta = category ? STORAGE_CATEGORY_META[category] : STORAGE_CATEGORY_META.other
  const ActiveIcon = activeMeta.icon

  return (
    <>
      <Dialog open={category !== null} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <div className="border-b px-4 py-3.5">
            <DialogHeader className="gap-1 pr-8">
              <DialogTitle className="text-base">{t('storage.manageFilesTitle')}</DialogTitle>
              <DialogDescription className="text-xs">{t('storage.manageFilesDescription')}</DialogDescription>
            </DialogHeader>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Select
                value={category ?? undefined}
                onValueChange={(value) => changeCategory(value as StorageUsageCategory)}
              >
                <SelectTrigger className="h-9 w-full bg-background sm:w-[220px]" aria-label={t('storage.fileType')}>
                  <SelectValue>
                    <ActiveIcon className="size-4" style={{ color: activeMeta.color }} />
                    {category ? t(`storage.category.${category}`) : ''}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="start">
                  {STORAGE_USAGE_CATEGORIES.map((option) => {
                    const optionMeta = STORAGE_CATEGORY_META[option]
                    const OptionIcon = optionMeta.icon
                    const breakdown = breakdowns.find((row) => row.category === option)
                    return (
                      <SelectItem key={option} value={option}>
                        <OptionIcon className="size-4" style={{ color: optionMeta.color }} />
                        <span className="flex-1">{t(`storage.category.${option}`)}</span>
                        <span className="ml-4 text-xs tabular-nums text-muted-foreground">
                          {formatSize(breakdown?.bytes ?? 0)}
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full" style={{ backgroundColor: activeMeta.color }} />
                <span className="text-muted-foreground">{t('storage.categoryUsage')}</span>
                <span className="font-medium tabular-nums">{formatSize(activeBreakdown?.bytes ?? 0)}</span>
                <span className="text-muted-foreground">
                  · {t('storage.fileCount', { count: activeBreakdown?.fileCount ?? 0 })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex min-h-11 items-center justify-between gap-3 border-b px-4">
              <div className="min-w-0 text-xs">
                {selectedIds.size > 0 ? (
                  <>
                    <span className="font-medium">{t('storage.selectedCount', { count: selectedIds.size })}</span>
                    <span className="ml-2 text-muted-foreground">{formatSize(selectedBytes)}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t('storage.selectFilesHint')}</span>
                )}
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 px-2.5"
                aria-label={t('storage.deleteSelected')}
                disabled={selectedItems.length === 0}
                onClick={() => setPendingDeleteItems(selectedItems)}
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">{t('storage.deleteSelected')}</span>
                {selectedItems.length > 0 && <span>({selectedItems.length})</span>}
              </Button>
            </div>

            <div className="min-h-0 max-h-[360px] overflow-y-auto">
              {itemsQuery.isLoading ? (
                <StorageItemsSkeleton />
              ) : itemsQuery.isError ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-muted-foreground">{t('storage.filesLoadFailed')}</p>
                  <Button variant="outline" size="sm" onClick={() => itemsQuery.refetch()}>
                    {t('storage.retry')}
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
                    <ActiveIcon className="size-5" />
                  </span>
                  <p className="text-sm">{t('storage.noFiles')}</p>
                </div>
              ) : (
                <Table className="table-fixed" containerClassName="overflow-x-hidden">
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 w-10 px-2 text-center">
                        <Checkbox
                          aria-label={t('storage.selectAll')}
                          checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                          onCheckedChange={() =>
                            setSelectedIds(allVisibleSelected ? new Set() : new Set(items.map((item) => item.id)))
                          }
                        />
                      </TableHead>
                      <SortableTableHead
                        field="name"
                        label={t('storage.columnName')}
                        activeField={sortBy}
                        direction={sortDir}
                        onChange={changeSort}
                      />
                      <TableHead className="hidden h-8 w-32 text-xs md:table-cell">{t('storage.columnType')}</TableHead>
                      <SortableTableHead
                        field="updatedAt"
                        label={t('storage.columnUpdated')}
                        activeField={sortBy}
                        direction={sortDir}
                        className="hidden w-28 sm:table-cell"
                        onChange={changeSort}
                      />
                      <SortableTableHead
                        field="size"
                        label={t('storage.columnSize')}
                        activeField={sortBy}
                        direction={sortDir}
                        className="w-20"
                        align="right"
                        onChange={changeSort}
                      />
                      <TableHead className="h-8 w-11">
                        <span className="sr-only">{t('common.actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const selected = selectedIds.has(item.id)
                      return (
                        <TableRow key={item.id} data-state={selected ? 'selected' : undefined}>
                          <TableCell className="w-10 px-2 py-1.5 text-center">
                            <Checkbox
                              aria-label={t('storage.selectFile', { name: item.name })}
                              checked={selected}
                              onCheckedChange={() => toggleSelection(item.id)}
                            />
                          </TableCell>
                          <TableCell className="min-w-0 py-1.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70">
                                <ActiveIcon className="size-3.5" style={{ color: activeMeta.color }} />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium" title={item.name}>
                                  {item.name}
                                </p>
                                <p className="truncate text-[11px] text-muted-foreground md:hidden">
                                  {formatMimeType(item.type)}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell
                            className="hidden max-w-32 truncate py-1.5 text-xs text-muted-foreground md:table-cell"
                            title={item.type}
                          >
                            {formatMimeType(item.type)}
                          </TableCell>
                          <TableCell className="hidden py-1.5 text-xs text-muted-foreground sm:table-cell">
                            {formatDate(item.updatedAt)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right text-xs font-medium tabular-nums">
                            {formatSize(item.size)}
                          </TableCell>
                          <TableCell className="py-1.5 pr-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={t('storage.deleteFile', { name: item.name })}
                              onClick={() => setPendingDeleteItems([item])}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="flex min-h-11 items-center justify-between gap-3 border-t px-4 text-xs">
              <span className="text-muted-foreground tabular-nums">
                {t('storage.pageItems', {
                  start: total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
                  end: Math.min(page * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  aria-label={t('storage.previousPage')}
                  disabled={page <= 1 || itemsQuery.isLoading}
                  onClick={() => changePage(page - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="min-w-12 text-center tabular-nums text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="size-7"
                  aria-label={t('storage.nextPage')}
                  disabled={page >= totalPages || itemsQuery.isLoading}
                  onClick={() => changePage(page + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDeleteItems.length > 0}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setPendingDeleteItems([])
            setDeleteErrors([])
          }
        }}
      >
        <DialogContent className="gap-3 p-4 sm:max-w-sm">
          <DialogHeader className="gap-1 pr-7">
            <DialogTitle className="text-base">{t('storage.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('storage.deleteConfirmDescription', {
                count: pendingDeleteItems.length,
                size: formatSize(pendingDeleteItems.reduce((sum, item) => sum + item.size, 0)),
              })}
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.isPending && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t('storage.deletingProgress', deleteProgress)}
              </div>
            </div>
          )}
          {deleteErrors.length > 0 && (
            <div className="max-h-28 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {deleteErrors.map((failure) => (
                <p key={failure.item.id} className="truncate text-xs text-destructive" title={failure.error.message}>
                  {failure.item.name}: {failure.error.message}
                </p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setPendingDeleteItems([])
                setDeleteErrors([])
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(pendingDeleteItems)}
            >
              {deleteMutation.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t('storage.deletePermanently')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

async function deleteStorageUsageItem(item: StorageUsageItem) {
  if (item.source === 'image_hosting') {
    await deleteIhostImage(item.id)
    return
  }
  if (item.source === 'trash') {
    await purgeTrashObject(item.id)
    return
  }
  await deleteObject(item.id)
  await purgeTrashObject(item.id)
}

function SortableTableHead({
  field,
  label,
  activeField,
  direction,
  className,
  align = 'left',
  onChange,
}: {
  field: StorageUsageSortField
  label: string
  activeField: StorageUsageSortField
  direction: StorageUsageSortDirection
  className?: string
  align?: 'left' | 'right'
  onChange: (field: StorageUsageSortField) => void
}) {
  const active = activeField === field
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <TableHead
      className={cn('h-8 text-xs', className)}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1 rounded-sm py-1.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          align === 'right' && 'justify-end',
          !active && 'text-muted-foreground',
        )}
        onClick={() => onChange(field)}
      >
        {label}
        <Icon className="size-3.5" />
      </button>
    </TableHead>
  )
}

function formatMimeType(mimeType: string) {
  const label = mimeType.split('/').at(-1) ?? mimeType
  return label.replace(/^x-/, '').replaceAll('-', ' ').toUpperCase()
}

function StorageItemsSkeleton() {
  return (
    <div className="space-y-px">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex h-10 items-center gap-2 border-b px-4">
          <Skeleton className="size-4" />
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-3 max-w-52 flex-1" />
          <Skeleton className="hidden h-3 w-20 sm:block" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  )
}
