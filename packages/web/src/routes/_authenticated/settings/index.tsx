import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { Storage } from '@zpan/shared'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertDialog } from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2, Plus } from 'lucide-react'
import {
  useSystemOption,
  useSetSystemOption,
  useStorages,
  useDeleteStorage,
} from '@/features/admin/api'
import { StorageForm } from '@/features/admin/components/storage-form'
import { formatBytes } from '@/features/admin/components/format'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsPage,
})

function SettingsPage() {
  const [tab, setTab] = useState('general')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={setTab}>
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

function GeneralTab() {
  const siteName = useSystemOption('site.name')
  const siteDesc = useSystemOption('site.description')
  const setOption = useSetSystemOption()

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [initialized, setInitialized] = useState(false)

  if (!initialized && siteName.data && siteDesc.data) {
    setName(siteName.data.value)
    setDesc(siteDesc.data.value)
    setInitialized(true)
  }

  function handleSave() {
    Promise.all([
      setOption.mutateAsync({ key: 'site.name', value: name }),
      setOption.mutateAsync({ key: 'site.description', value: desc }),
    ])
      .then(() => toast.success('Settings saved'))
      .catch((err: Error) => toast.error(err.message))
  }

  return (
    <div className="max-w-lg space-y-4 pt-4">
      <div className="space-y-1.5">
        <Label>Site Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Site Description</Label>
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} />
      </div>
      <Button onClick={handleSave} disabled={setOption.isPending}>
        {setOption.isPending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

function StorageTab() {
  const { data, isLoading } = useStorages()
  const deleteStorage = useDeleteStorage()
  const [formOpen, setFormOpen] = useState(false)
  const [editStorage, setEditStorage] = useState<Storage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Storage | null>(null)

  const items = data?.items ?? []

  function handleEdit(s: Storage) {
    setEditStorage(s)
    setFormOpen(true)
  }

  function handleAdd() {
    setEditStorage(null)
    setFormOpen(true)
  }

  function handleDelete() {
    if (!deleteTarget) return
    deleteStorage.mutate(deleteTarget.id, {
      onSuccess: () => toast.success('Storage deleted'),
      onError: (err) => toast.error(err.message),
    })
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end">
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Storage
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-24">Mode</TableHead>
              <TableHead>Bucket</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead className="w-40">Usage</TableHead>
              <TableHead className="w-20">Priority</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No storage backends configured
                </TableCell>
              </TableRow>
            )}
            {items.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.title}</TableCell>
                <TableCell>
                  <Badge variant={s.mode === 'public' ? 'default' : 'secondary'}>{s.mode}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{s.bucket}</TableCell>
                <TableCell className="text-muted-foreground truncate max-w-[200px]">
                  {s.endpoint}
                </TableCell>
                <TableCell>
                  <UsageCell storage={s} />
                </TableCell>
                <TableCell className="text-center">{s.priority}</TableCell>
                <TableCell>
                  <Badge variant={s.status === 1 ? 'outline' : 'destructive'}>
                    {s.status === 1 ? 'Active' : 'Disabled'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleEdit(s)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <StorageForm open={formOpen} onOpenChange={setFormOpen} storage={editStorage} />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Storage"
        description={`Are you sure you want to delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        pending={deleteStorage.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function UsageCell({ storage }: { storage: Storage }) {
  if (!storage.capacityBytes) {
    return (
      <span className="text-sm text-muted-foreground">
        {formatBytes(storage.usedBytes)} / Unlimited
      </span>
    )
  }

  const pct = Math.round((storage.usedBytes / storage.capacityBytes) * 100)
  return (
    <div className="space-y-1">
      <Progress value={pct} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {formatBytes(storage.usedBytes)} / {formatBytes(storage.capacityBytes)}
      </p>
    </div>
  )
}
