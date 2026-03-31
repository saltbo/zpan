import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Storage } from '@zpan/shared/types'
import {
  useStorages,
  useDeleteStorage,
  useSystemOption,
  useSetSystemOption,
} from '@/features/admin/api'
import { StorageForm } from '@/features/admin/components/storage-form'
import { toast } from 'sonner'

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
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="storage">
          <StorageBackends />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// --- General Settings Tab ---

function GeneralSettings() {
  const siteName = useSystemOption('site.name')
  const siteDesc = useSystemOption('site.description')
  const setOption = useSetSystemOption()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (siteName.data) setName(siteName.data.value ?? '')
  }, [siteName.data])

  useEffect(() => {
    if (siteDesc.data) setDescription(siteDesc.data.value ?? '')
  }, [siteDesc.data])

  async function handleSave() {
    await Promise.all([
      setOption.mutateAsync({ key: 'site.name', value: name }),
      setOption.mutateAsync({ key: 'site.description', value: description }),
    ])
    toast.success('Settings saved')
  }

  const loading = siteName.isLoading || siteDesc.isLoading

  return (
    <div className="max-w-lg space-y-4 pt-4">
      <div className="grid gap-2">
        <Label>Site Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={loading}
          placeholder="ZPan"
        />
      </div>
      <div className="grid gap-2">
        <Label>Site Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={loading}
          placeholder="Your S3-native file hosting platform"
          rows={3}
        />
      </div>
      <Button onClick={handleSave} disabled={setOption.isPending}>
        {setOption.isPending && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </div>
  )
}

// --- Storage Backends Tab ---

const GB = 1024 * 1024 * 1024

function formatCapacity(bytes: number | null): string {
  if (!bytes) return 'Unlimited'
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function statusLabel(status: number): {
  text: string
  variant: 'default' | 'secondary' | 'destructive'
} {
  if (status === 1) return { text: 'Active', variant: 'default' }
  if (status === -1) return { text: 'Error', variant: 'destructive' }
  return { text: 'Inactive', variant: 'secondary' }
}

function StorageBackends() {
  const { data, isLoading } = useStorages()
  const deleteStorage = useDeleteStorage()
  const [formOpen, setFormOpen] = useState(false)
  const [editStorage, setEditStorage] = useState<Storage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Storage | null>(null)

  function openCreate() {
    setEditStorage(null)
    setFormOpen(true)
  }

  function openEdit(storage: Storage) {
    setEditStorage(storage)
    setFormOpen(true)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteStorage.mutateAsync(deleteTarget.id)
    toast.success('Storage deleted')
    setDeleteTarget(null)
  }

  const colCount = 8

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage S3-compatible storage backends.</p>
        <Button onClick={openCreate}>
          <Plus />
          Add Storage
        </Button>
      </div>

      <div className="rounded-md border">
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
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            )}
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  No storage backends configured.
                </TableCell>
              </TableRow>
            )}
            {data?.items.map((s) => {
              const pct = s.capacityBytes ? Math.round((s.usedBytes / s.capacityBytes) * 100) : 0
              const st = statusLabel(s.status)
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.title}</TableCell>
                  <TableCell>
                    <Badge variant={s.mode === 'public' ? 'default' : 'secondary'}>{s.mode}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.bucket}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-40 truncate">
                    {s.endpoint}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-32">
                      <Progress value={pct} className="h-2 flex-1" />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatCapacity(s.usedBytes)} / {formatCapacity(s.capacityBytes)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{s.priority}</TableCell>
                  <TableCell>
                    <Badge variant={st.variant}>{st.text}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => openEdit(s)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => setDeleteTarget(s)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <StorageForm open={formOpen} onOpenChange={setFormOpen} storage={editStorage} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Storage</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This cannot be
              undone and may affect files stored in this backend.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
