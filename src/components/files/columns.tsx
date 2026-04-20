import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import type { ColumnDef, Row } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDate, formatSize } from '@/lib/format'
import { FileIcon } from './file-icon'
import { FileRowActions } from './file-row-actions'
import type { FileActionHandlers } from './types'

function foldersFirstSort(rowA: Row<StorageObject>, rowB: Row<StorageObject>): number {
  const aIsFolder = rowA.original.dirtype !== DirType.FILE
  const bIsFolder = rowB.original.dirtype !== DirType.FILE
  if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1
  return 0
}

interface ColumnOptions {
  selectionEnabled?: boolean
}

function hasRowActions(handlers: FileActionHandlers) {
  return !!(
    handlers.onDownload ||
    handlers.onRename ||
    handlers.onCopy ||
    handlers.onMove ||
    handlers.onShare ||
    handlers.onTrash
  )
}

export function getColumns(
  handlers: FileActionHandlers,
  t: (key: string) => string,
  { selectionEnabled = true }: ColumnOptions = {},
): ColumnDef<StorageObject>[] {
  const columns: ColumnDef<StorageObject>[] = [
    ...(selectionEnabled
      ? [
          {
            id: 'select',
            header: ({ table }) => (
              <Checkbox
                checked={table.getIsAllPageRowsSelected()}
                onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
              />
            ),
            cell: ({ row }) => (
              <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(v) => row.toggleSelected(!!v)}
                onClick={(e) => e.stopPropagation()}
              />
            ),
            size: 28,
            meta: { className: 'w-8 px-2' },
            enableSorting: false,
          } satisfies ColumnDef<StorageObject>,
        ]
      : []),
    {
      accessorKey: 'name',
      header: t('files.colName'),
      cell: ({ row }) => (
        <button
          type="button"
          className="flex items-center gap-2 cursor-pointer bg-transparent border-none p-0"
          onClick={() => handlers.onOpen(row.original)}
        >
          <FileIcon item={row.original} />
          <span className="truncate font-medium">{row.original.name}</span>
        </button>
      ),
      sortingFn: (rowA, rowB, columnId) => {
        const folderOrder = foldersFirstSort(rowA, rowB)
        if (folderOrder !== 0) return folderOrder
        return rowA.getValue<string>(columnId).localeCompare(rowB.getValue<string>(columnId))
      },
    },
    {
      accessorKey: 'size',
      header: t('files.colSize'),
      cell: ({ row }) => (row.original.dirtype !== DirType.FILE ? '—' : formatSize(row.original.size)),
      sortingFn: (rowA, rowB, columnId) => {
        const folderOrder = foldersFirstSort(rowA, rowB)
        if (folderOrder !== 0) return folderOrder
        return (rowA.getValue<number>(columnId) ?? 0) - (rowB.getValue<number>(columnId) ?? 0)
      },
      meta: { className: 'hidden sm:table-cell' },
    },
    {
      accessorKey: 'updatedAt',
      header: t('files.colModified'),
      cell: ({ getValue }) => formatDate(getValue<string>()),
      sortingFn: (rowA, rowB, columnId) => {
        const folderOrder = foldersFirstSort(rowA, rowB)
        if (folderOrder !== 0) return folderOrder
        return new Date(rowA.getValue<string>(columnId)).getTime() - new Date(rowB.getValue<string>(columnId)).getTime()
      },
      meta: { className: 'hidden md:table-cell' },
    },
  ]

  if (hasRowActions(handlers)) {
    columns.push({
      id: 'actions',
      cell: ({ row }) => <FileRowActions item={row.original} handlers={handlers} />,
      size: 48,
      enableSorting: false,
    })
  }

  return columns
}
