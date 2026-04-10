import { useDraggable, useDroppable } from '@dnd-kit/core'
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { flexRender, type Row, type Table as TanstackTable } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FileActionHandlers } from './types'

interface FilesTableProps {
  table: TanstackTable<StorageObject>
  handlers: FileActionHandlers
  selectedIds: string[]
  currentPath: string
}

function SortIndicator({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (!direction) return null
  return direction === 'asc' ? (
    <ArrowUp className="ml-1 inline h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 inline h-3 w-3" />
  )
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function DraggableDroppableRow({
  row,
  handlers,
  selectedIds,
  currentPath,
  allItems,
}: {
  row: Row<StorageObject>
  handlers: FileActionHandlers
  selectedIds: string[]
  currentPath: string
  allItems: StorageObject[]
}) {
  const { t } = useTranslation()
  const item = row.original
  const isFolder = item.dirtype !== DirType.FILE
  const isFile = item.dirtype === DirType.FILE
  const folderPath = isFolder ? buildPath(currentPath, item.name) : ''

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-${item.id}`,
    data: { folderPath },
    disabled: !isFolder,
  })

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `drag-${item.id}`,
    data: { item, selectedIds, allItems },
  })

  // Remove role="button" that useDraggable adds — it breaks table semantics
  const { role: _, tabIndex: __, ...cleanAttributes } = attributes

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow
          ref={(node) => {
            setDragRef(node)
            if (isFolder) setDropRef(node)
          }}
          data-state={row.getIsSelected() ? 'selected' : undefined}
          className={`${isOver ? 'bg-primary/5 ring-2 ring-primary' : ''} ${isDragging ? 'opacity-40' : ''}`}
          {...cleanAttributes}
          {...listeners}
        >
          {row.getVisibleCells().map((cell) => (
            <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
          ))}
        </TableRow>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => handlers.onOpen(item)}>
          {isFile ? t('files.preview') : t('files.open')}
        </ContextMenuItem>
        {isFile && <ContextMenuItem onClick={() => handlers.onDownload(item)}>{t('files.download')}</ContextMenuItem>}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handlers.onRename(item)}>{t('files.rename')}</ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.onCopy(item)}>{t('files.copy')}</ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.onMove(item)}>{t('files.moveTo')}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => handlers.onTrash(item)}>
          {t('files.moveToTrash')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function FilesTable({ table, handlers, selectedIds, currentPath }: FilesTableProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                style={{ width: header.column.getSize() }}
                className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                onClick={header.column.getToggleSortingHandler()}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanSort() && <SortIndicator direction={header.column.getIsSorted()} />}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
              {t('files.emptyState')}
            </TableCell>
          </TableRow>
        )}
        {table.getRowModel().rows.map((row) => (
          <DraggableDroppableRow
            key={row.id}
            row={row}
            handlers={handlers}
            selectedIds={selectedIds}
            currentPath={currentPath}
            allItems={table.getRowModel().rows.map((r) => r.original)}
          />
        ))}
      </TableBody>
    </Table>
  )
}
