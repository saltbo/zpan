import type { StorageObject } from '@zpan/shared'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Trash2,
  Folder,
  FileImage,
  FileVideo,
  FileAudio,
  FileText,
  File as FileIcon,
} from 'lucide-react'
import { TrashContextMenu } from './trash-context-menu'
import { formatFileSize, formatDate, isFolder, mimeCategory } from '@/features/files/utils'

interface TrashListProps {
  items: StorageObject[]
  total: number
  isLoading: boolean
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onRestore: (item: StorageObject) => void
  onDeleteForever: (item: StorageObject) => void
  onProperties: (item: StorageObject) => void
  onLoadMore?: () => void
}

function FileTypeIcon({ item }: { item: StorageObject }) {
  if (isFolder(item)) return <Folder className="h-5 w-5 text-blue-500" />
  const cat = mimeCategory(item.type)
  switch (cat) {
    case 'image':
      return <FileImage className="h-5 w-5 text-green-500" />
    case 'video':
      return <FileVideo className="h-5 w-5 text-purple-500" />
    case 'audio':
      return <FileAudio className="h-5 w-5 text-orange-500" />
    case 'text':
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />
    default:
      return <FileIcon className="h-5 w-5 text-muted-foreground" />
  }
}

export function TrashList({
  items,
  total,
  isLoading,
  selectedIds,
  onSelectionChange,
  onRestore,
  onDeleteForever,
  onProperties,
  onLoadMore,
}: TrashListProps) {
  if (isLoading) return <LoadingSkeleton />

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
        <Trash2 className="h-12 w-12" />
        <p className="text-sm">Trash is empty</p>
      </div>
    )
  }

  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id))

  function toggleAll() {
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(items.map((i) => i.id)))
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }

  const hasMore = items.length < total

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="w-28">Size</TableHead>
            <TableHead className="w-36">Deleted</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TrashContextMenu
              key={item.id}
              item={item}
              onRestore={() => onRestore(item)}
              onDeleteForever={() => onDeleteForever(item)}
              onProperties={() => onProperties(item)}
            >
              <TableRow
                data-state={selectedIds.has(item.id) ? 'selected' : undefined}
                className="cursor-default"
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleOne(item.id)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileTypeIcon item={item} />
                    <span className="truncate">{item.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {isFolder(item) ? '—' : formatFileSize(item.size)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(item.updatedAt)}
                </TableCell>
              </TableRow>
            </TrashContextMenu>
          ))}
        </TableBody>
      </Table>
      {hasMore && (
        <div className="flex items-center justify-center gap-2 py-4">
          <span className="text-sm text-muted-foreground">
            Showing {items.length} of {total}
          </span>
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 pt-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  )
}
