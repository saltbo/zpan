import { useDraggable, useDroppable } from '@dnd-kit/core'
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { flexRender, type Row, type Table as TanstackTable } from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { FileActionsContextContent } from './file-actions-menu'
import type { FileActionHandlers } from './types'

interface FilesTableProps {
  table: TanstackTable<StorageObject>
  handlers: FileActionHandlers
  selectedIds: string[]
  currentPath: string
  dragAndDropEnabled?: boolean
  selectionEnabled?: boolean
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
  const item = row.original
  const isFolder = item.dirtype !== DirType.FILE
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
          className={cn(isOver && 'bg-primary/5 ring-2 ring-primary', isDragging && 'opacity-40')}
          {...cleanAttributes}
          {...listeners}
        >
          {row.getVisibleCells().map((cell) => (
            <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
      </ContextMenuTrigger>
      <FileActionsContextContent item={item} handlers={handlers} />
    </ContextMenu>
  )
}

function PlainRow({ row, handlers }: { row: Row<StorageObject>; handlers: FileActionHandlers }) {
  const item = row.original

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableRow data-state={row.getIsSelected() ? 'selected' : undefined}>
          {row.getVisibleCells().map((cell) => (
            <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
      </ContextMenuTrigger>
      <FileActionsContextContent item={item} handlers={handlers} />
    </ContextMenu>
  )
}

export function FilesTable({ table, handlers, selectedIds, currentPath, dragAndDropEnabled = true }: FilesTableProps) {
  const { t } = useTranslation()
  const rows = table.getRowModel().rows
  const allItems = rows.map((r) => r.original)

  return (
    <Table className="table-fixed">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="bg-muted/50 hover:bg-muted/50">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                style={header.column.columnDef.meta?.flex ? undefined : { width: header.column.getSize() }}
                className={cn(
                  header.column.columnDef.meta?.className,
                  header.column.getCanSort() && 'cursor-pointer select-none',
                )}
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
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={table.getAllColumns().length} className="h-24 text-center">
              {t('files.emptyState')}
            </TableCell>
          </TableRow>
        )}
        {rows.map((row) =>
          dragAndDropEnabled ? (
            <DraggableDroppableRow
              key={row.id}
              row={row}
              handlers={handlers}
              selectedIds={selectedIds}
              currentPath={currentPath}
              allItems={allItems}
            />
          ) : (
            <PlainRow key={row.id} row={row} handlers={handlers} />
          ),
        )}
      </TableBody>
    </Table>
  )
}
