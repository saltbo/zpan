import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import type { PaginatedResponse, Storage } from '@zpan/shared/types'
import { Database, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { StorageFormDialog, type StorageFormValues } from '@/components/admin/storage-form-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const Route = createFileRoute('/_authenticated/admin/storages/')({
  component: AdminStoragesPage,
})

type DialogState = { mode: 'create' } | { mode: 'edit'; storage: Storage } | null

const STORAGE_HAS_FILES = 'STORAGE_HAS_FILES'

async function fetchStorages(): Promise<PaginatedResponse<Storage>> {
  const res = await fetch('/api/admin/storages', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch storages')
  return res.json()
}

async function createStorage(data: StorageFormValues): Promise<Storage> {
  const res = await fetch('/api/admin/storages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create storage')
  return res.json()
}

async function updateStorage(id: string, data: StorageFormValues): Promise<Storage> {
  const res = await fetch(`/api/admin/storages/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update storage')
  return res.json()
}

async function deleteStorage(id: string): Promise<void> {
  const res = await fetch(`/api/admin/storages/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (res.status === 409) throw new Error(STORAGE_HAS_FILES)
  if (!res.ok) throw new Error('Failed to delete storage')
}

function AdminStoragesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const [deletingStorage, setDeletingStorage] = useState<Storage | undefined>()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'storages'],
    queryFn: fetchStorages,
  })

  const createMutation = useMutation({
    mutationFn: createStorage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      setDialogState(null)
      toast.success(t('admin.storages.createSuccess'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: StorageFormValues }) => updateStorage(id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      setDialogState(null)
      toast.success(t('admin.storages.updateSuccess'))
    },
    onError: () => toast.error(t('common.error')),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteStorage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      setDeletingStorage(undefined)
      toast.success(t('admin.storages.deleteSuccess'))
    },
    onError: (error: Error) => {
      if (error.message === STORAGE_HAS_FILES) {
        toast.error(t('admin.storages.deleteHasFiles'))
      } else {
        toast.error(t('common.error'))
      }
      setDeletingStorage(undefined)
    },
  })

  const columns = useStorageColumns(t, setDialogState, setDeletingStorage)

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  function handleFormSubmit(values: StorageFormValues) {
    if (dialogState?.mode === 'edit') {
      updateMutation.mutate({ id: dialogState.storage.id, values })
    } else {
      createMutation.mutate(values)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('admin.storages.title')}</h1>
        <Button onClick={() => setDialogState({ mode: 'create' })}>
          <Plus className="mr-2 h-4 w-4" />
          {t('admin.storages.addStorage')}
        </Button>
      </div>

      <StoragesTable table={table} isLoading={isLoading} isError={isError} isEmpty={!data?.items.length} t={t} />

      <StorageFormDialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) setDialogState(null)
        }}
        storage={dialogState?.mode === 'edit' ? dialogState.storage : undefined}
        onSubmit={handleFormSubmit}
        loading={createMutation.isPending || updateMutation.isPending}
      />

      <DeleteConfirmDialog
        storage={deletingStorage}
        onClose={() => setDeletingStorage(undefined)}
        onConfirm={(id) => deleteMutation.mutate(id)}
        t={t}
      />
    </div>
  )
}

function useStorageColumns(
  t: (key: string) => string,
  onEdit: (state: DialogState) => void,
  onDelete: (storage: Storage) => void,
): ColumnDef<Storage>[] {
  return useMemo(
    () => [
      { accessorKey: 'title', header: t('admin.storages.col.title') },
      {
        accessorKey: 'mode',
        header: t('admin.storages.col.mode'),
        cell: ({ row }) => (
          <Badge variant={row.original.mode === 'public' ? 'default' : 'secondary'}>{row.original.mode}</Badge>
        ),
      },
      { accessorKey: 'bucket', header: t('admin.storages.col.bucket') },
      {
        accessorKey: 'endpoint',
        header: t('admin.storages.col.endpoint'),
        cell: ({ row }) => <span className="block max-w-[200px] truncate">{row.original.endpoint}</span>,
      },
      {
        id: 'status',
        header: t('admin.storages.col.status'),
        cell: ({ row }) => (
          <Badge variant={row.original.status === 1 ? 'default' : 'outline'}>
            {row.original.status === 1 ? t('admin.storages.status.active') : t('admin.storages.status.inactive')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: t('admin.storages.col.actions'),
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => onEdit({ mode: 'edit', storage: row.original })}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onDelete(row.original)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [t, onEdit, onDelete],
  )
}

function StoragesTable({
  table,
  isLoading,
  isError,
  isEmpty,
  t,
}: {
  table: ReturnType<typeof useReactTable<Storage>>
  isLoading: boolean
  isError: boolean
  isEmpty: boolean
  t: (key: string) => string
}) {
  if (isLoading) {
    return <div className="py-20 text-center text-muted-foreground">{t('common.loading')}</div>
  }

  if (isError) {
    return <div className="py-20 text-center text-destructive">{t('common.error')}</div>
  }

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
        <Database className="h-16 w-16" />
        <p>{t('admin.storages.noStorages')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function DeleteConfirmDialog({
  storage,
  onClose,
  onConfirm,
  t,
}: {
  storage?: Storage
  onClose: () => void
  onConfirm: (id: string) => void
  t: (key: string, opts?: Record<string, string>) => string
}) {
  return (
    <AlertDialog
      open={!!storage}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.storages.deleteStorage')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('admin.storages.deleteConfirm', {
              title: storage?.title ?? '',
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => storage && onConfirm(storage.id)}>{t('common.delete')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
