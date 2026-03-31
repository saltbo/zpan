import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { Storage } from '@zpan/shared/types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  useSystemOption,
  useUpdateSystemOption,
  useStorages,
  useDeleteStorage,
} from '@/features/admin/api'
import { StorageForm } from '@/features/admin/components/storage-form'
import { formatBytes } from '@/features/admin/format'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="storage">Storage Backends</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralTab />
        </TabsContent>
        <TabsContent value="storage">
          <StorageTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- General Tab ---

function GeneralTab() {
  const siteName = useSystemOption('site.name')
  const siteDesc = useSystemOption('site.description')
  const updateOption = useUpdateSystemOption()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (siteName.data && siteDesc.data && !initialized) {
    setName(siteName.data.value ?? '')
    setDescription(siteDesc.data.value ?? '')
    setInitialized(true)
  }

  function handleSave() {
    Promise.all([
      updateOption.mutateAsync({ key: 'site.name', value: name }),
      updateOption.mutateAsync({ key: 'site.description', value: description }),
    ])
      .then(() => toast.success('Settings saved'))
      .catch((err) => toast.error(err.message || 'Failed to save'))
  }

  const isLoading = siteName.isLoading || siteDesc.isLoading

  return (
    <div className="max-w-lg space-y-4 pt-4">
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="site-name">Site Name</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ZPan"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="site-desc">Site Description</Label>
            <Textarea
              id="site-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="An open-source file hosting platform"
              rows={3}
            />
          </div>
          <Button onClick={handleSave} disabled={updateOption.isPending}>
            {updateOption.isPending ? 'Saving...' : 'Save'}
          </Button>
        </>
      )}
    </div>
  )
}

// --- Storage Backends Tab ---

function StorageTab() {
  const { data: storages, isLoading } = useStorages()
  const deleteMutation = useDeleteStorage()

  const [formOpen, setFormOpen] = useState(false)
  const [editingStorage, setEditingStorage] = useState<Storage | null>(null)
  const [deletingStorage, setDeletingStorage] = useState<Storage | null>(null)

  function openCreate() {
    setEditingStorage(null)
    setFormOpen(true)
  }

  function openEdit(storage: Storage) {
    setEditingStorage(storage)
    setFormOpen(true)
  }

  function handleDelete() {
    if (!deletingStorage) return
    deleteMutation.mutate(deletingStorage.id, {
      onSuccess: () => {
        toast.success('Storage deleted')
        setDeletingStorage(null)
      },
      onError: (err) => toast.error(err.message || 'Failed to delete storage'),
    })
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Storage
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Bucket</TableHead>
            <TableHead>Endpoint</TableHead>
            <TableHead>Usage</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[80px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading &&
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={8}>
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ))}
          {storages?.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.title}</TableCell>
              <TableCell>
                <Badge variant={s.mode === 'public' ? 'default' : 'secondary'}>{s.mode}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{s.bucket}</TableCell>
              <TableCell className="text-muted-foreground text-xs max-w-[200px] truncate">
                {s.endpoint}
              </TableCell>
              <TableCell>
                <UsageCell used={s.usedBytes} capacity={s.capacityBytes} />
              </TableCell>
              <TableCell>{s.priority}</TableCell>
              <TableCell>
                <Badge variant={s.status === 1 ? 'default' : 'outline'}>
                  {s.status === 1 ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => openEdit(s)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setDeletingStorage(s)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {storages && storages.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                No storage backends configured.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <StorageForm open={formOpen} onOpenChange={setFormOpen} storage={editingStorage} />

      <AlertDialog
        open={!!deletingStorage}
        onOpenChange={(open) => !open && setDeletingStorage(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete storage?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deletingStorage?.title}&quot;. Files using this
              storage may become inaccessible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function UsageCell({ used, capacity }: { used: number; capacity: number | null }) {
  if (!capacity) {
    return <span className="text-sm text-muted-foreground">{formatBytes(used)} / Unlimited</span>
  }
  const pct = Math.round((used / capacity) * 100)
  return (
    <div className="space-y-1 min-w-[120px]">
      <Progress value={pct} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        {formatBytes(used)} / {formatBytes(capacity)}
      </p>
    </div>
  )
}
