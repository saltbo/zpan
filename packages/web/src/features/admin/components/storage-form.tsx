import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Storage } from '@zpan/shared'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useCreateStorage, useUpdateStorage } from '@/features/admin/api'

const storageFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1, 'Bucket is required'),
  endpoint: z.string().url('Must be a valid URL'),
  region: z.string(),
  accessKey: z.string().min(1, 'Access key is required'),
  secretKey: z.string().min(1, 'Secret key is required'),
  filePath: z.string(),
  customHost: z.string().optional(),
  capacityBytes: z.number().optional(),
  priority: z.number(),
})

type FormValues = z.infer<typeof storageFormSchema>

interface StorageFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage?: Storage | null
}

const GB = 1024 * 1024 * 1024

export function StorageForm({ open, onOpenChange, storage }: StorageFormProps) {
  const isEdit = !!storage
  const createStorage = useCreateStorage()
  const updateStorage = useUpdateStorage()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(storageFormSchema),
    defaultValues: {
      title: '',
      mode: 'private',
      bucket: '',
      endpoint: '',
      region: 'auto',
      accessKey: '',
      secretKey: '',
      filePath: '$UID/$RAW_NAME',
      customHost: '',
      capacityBytes: undefined,
      priority: 0,
    },
  })

  useEffect(() => {
    if (open && storage) {
      reset({
        title: storage.title,
        mode: storage.mode,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        filePath: storage.filePath,
        customHost: storage.customHost || '',
        capacityBytes: storage.capacityBytes ?? undefined,
        priority: storage.priority,
      })
    } else if (open) {
      reset({
        title: '',
        mode: 'private',
        bucket: '',
        endpoint: '',
        region: 'auto',
        accessKey: '',
        secretKey: '',
        filePath: '$UID/$RAW_NAME',
        customHost: '',
        capacityBytes: undefined,
        priority: 0,
      })
    }
  }, [open, storage, reset])

  const [capacityGB, setCapacityGB] = useState('')

  useEffect(() => {
    if (open && storage?.capacityBytes) {
      setCapacityGB(String(storage.capacityBytes / GB))
    } else if (open) {
      setCapacityGB('')
    }
  }, [open, storage])

  function onSubmit(values: FormValues) {
    const payload = {
      ...values,
      capacityBytes: capacityGB ? Number(capacityGB) * GB : undefined,
    }

    const mutation =
      isEdit && storage
        ? updateStorage.mutateAsync({ id: storage.id, ...payload })
        : createStorage.mutateAsync(payload)

    mutation
      .then(() => {
        toast.success(isEdit ? 'Storage updated' : 'Storage created')
        onOpenChange(false)
      })
      .catch((err: Error) => toast.error(err.message))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Storage' : 'Add Storage'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Title" error={errors.title?.message}>
            <Input {...register('title')} />
          </Field>

          <Field label="Mode" error={errors.mode?.message}>
            <Select {...register('mode')}>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </Select>
          </Field>

          <Field label="Bucket" error={errors.bucket?.message}>
            <Input {...register('bucket')} />
          </Field>

          <Field label="Endpoint" error={errors.endpoint?.message}>
            <Input {...register('endpoint')} placeholder="https://xxx.r2.cloudflarestorage.com" />
          </Field>

          <Field label="Region" error={errors.region?.message}>
            <Input {...register('region')} />
          </Field>

          <Field label="Access Key" error={errors.accessKey?.message}>
            <Input {...register('accessKey')} />
          </Field>

          <Field label="Secret Key" error={errors.secretKey?.message}>
            <Input {...register('secretKey')} type="password" />
          </Field>

          <Field label="File Path Template" error={errors.filePath?.message}>
            <Input {...register('filePath')} />
            <p className="text-xs text-muted-foreground mt-1">
              Variables: $UID (user ID), $RAW_NAME (original filename), $DATE (YYYY/MM/DD)
            </p>
          </Field>

          <Field label="Custom Host (optional)">
            <Input {...register('customHost')} placeholder="CDN domain for public mode" />
          </Field>

          <Field label="Capacity (GB)">
            <Input
              type="number"
              min={0}
              step="any"
              value={capacityGB}
              onChange={(e) => setCapacityGB(e.target.value)}
              placeholder="Leave empty for unlimited"
            />
          </Field>

          <Field label="Priority" error={errors.priority?.message}>
            <Input {...register('priority', { valueAsNumber: true })} type="number" />
            <p className="text-xs text-muted-foreground mt-1">Lower value = used first</p>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
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
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
