import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { createStorageSchema } from '@zpan/shared/schemas'
import type { Storage } from '@zpan/shared/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateStorage, useUpdateStorage } from '../api'
import { toast } from 'sonner'
import { Loader2, PlugZap } from 'lucide-react'

type FormValues = z.infer<typeof createStorageSchema>

interface StorageFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage?: Storage | null
}

const GB = 1024 * 1024 * 1024

function defaultsFromStorage(storage: Storage | null | undefined): FormValues {
  if (storage) {
    return {
      title: storage.title,
      mode: storage.mode,
      bucket: storage.bucket,
      endpoint: storage.endpoint,
      region: storage.region,
      accessKey: storage.accessKey,
      secretKey: storage.secretKey,
      filePath: storage.filePath,
      customHost: storage.customHost || undefined,
      capacityBytes: storage.capacityBytes ?? undefined,
      priority: storage.priority,
    }
  }
  return {
    title: '',
    mode: 'private',
    bucket: '',
    endpoint: '',
    region: 'auto',
    accessKey: '',
    secretKey: '',
    filePath: '$UID/$RAW_NAME',
    customHost: undefined,
    capacityBytes: undefined,
    priority: 0,
  }
}

export function StorageForm({ open, onOpenChange, storage }: StorageFormProps) {
  const isEdit = !!storage
  const create = useCreateStorage()
  const update = useUpdateStorage()
  const [testing, setTesting] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(createStorageSchema),
    defaultValues: defaultsFromStorage(storage),
  })

  useEffect(() => {
    if (open) {
      form.reset(defaultsFromStorage(storage))
    }
  }, [open, storage, form])

  const pending = create.isPending || update.isPending

  async function onSubmit(values: FormValues) {
    const payload = {
      ...values,
      capacityBytes: values.capacityBytes ?? null,
    }
    if (isEdit) {
      await update.mutateAsync({ id: storage.id, data: payload })
      toast.success('Storage updated')
    } else {
      await create.mutateAsync(payload)
      toast.success('Storage created')
    }
    onOpenChange(false)
  }

  async function handleTestConnection() {
    const values = form.getValues()
    setTesting(true)
    try {
      const res = await fetch('/api/storages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, _testOnly: true }),
      })
      if (res.ok || res.status === 201) {
        toast.success('Connection successful')
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body.message ?? 'Connection failed')
      }
    } catch {
      toast.error('Connection failed')
    } finally {
      setTesting(false)
    }
  }

  const errors = form.formState.errors
  const err = (field: keyof FormValues & string) => errors[field]?.message as string | undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Storage' : 'Add Storage'}</DialogTitle>
          <DialogDescription>Configure an S3-compatible storage backend.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-2">
          <Field label="Title" error={err('title')}>
            <Input {...form.register('title')} placeholder="My Storage" />
          </Field>

          <Field label="Mode" error={err('mode')}>
            <Select
              value={form.watch('mode')}
              onValueChange={(v) => form.setValue('mode', v as 'private' | 'public')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Bucket" error={err('bucket')}>
            <Input {...form.register('bucket')} placeholder="my-bucket" />
          </Field>

          <Field label="Endpoint" error={err('endpoint')}>
            <Input
              {...form.register('endpoint')}
              placeholder="https://xxx.r2.cloudflarestorage.com"
            />
          </Field>

          <Field label="Region" error={err('region')}>
            <Input {...form.register('region')} placeholder="auto" />
          </Field>

          <Field label="Access Key" error={err('accessKey')}>
            <Input {...form.register('accessKey')} />
          </Field>

          <Field label="Secret Key" error={err('secretKey')}>
            <Input type="password" {...form.register('secretKey')} />
          </Field>

          <Field label="File Path Template" error={err('filePath')}>
            <Input {...form.register('filePath')} />
            <p className="text-xs text-muted-foreground">Variables: $UID, $RAW_NAME, $DATE, $EXT</p>
          </Field>

          <Field label="Custom Host (optional)">
            <Input {...form.register('customHost')} placeholder="cdn.example.com" />
          </Field>

          <Field label="Capacity (GB, optional)">
            <Input
              type="number"
              {...form.register('capacityBytes', {
                setValueAs: (v: string) => (v === '' ? undefined : Number(v) * GB),
              })}
              defaultValue={storage?.capacityBytes ? String(storage.capacityBytes / GB) : ''}
              placeholder="Leave empty for unlimited"
            />
          </Field>

          <Field label="Priority" error={err('priority')}>
            <Input type="number" {...form.register('priority', { valueAsNumber: true })} />
            <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? <Loader2 className="animate-spin" /> : <PlugZap />}
              Test Connection
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {isEdit ? 'Save Changes' : 'Create Storage'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
