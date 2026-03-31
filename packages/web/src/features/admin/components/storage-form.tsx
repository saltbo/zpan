import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { createStorageSchema } from '@zpan/shared/schemas'
import type { Storage } from '@zpan/shared/types'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateStorage, useUpdateStorage } from '../api'

type FormValues = z.infer<typeof createStorageSchema>

interface StorageFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage?: Storage | null
}

export function StorageForm({ open, onOpenChange, storage }: StorageFormProps) {
  const isEditing = !!storage
  const createMutation = useCreateStorage()
  const updateMutation = useUpdateStorage()

  const form = useForm<FormValues>({
    resolver: zodResolver(createStorageSchema),
    defaultValues: storage
      ? {
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
      : {
          title: '',
          mode: 'private' as const,
          bucket: '',
          endpoint: '',
          region: 'auto',
          accessKey: '',
          secretKey: '',
          filePath: '$UID/$RAW_NAME',
          priority: 0,
        },
  })

  function handleSubmit(values: FormValues) {
    const mutation = isEditing ? updateMutation : createMutation
    const payload = isEditing ? { id: storage?.id as string, ...values } : values

    mutation.mutate(payload as never, {
      onSuccess: () => {
        toast.success(isEditing ? 'Storage updated' : 'Storage created')
        onOpenChange(false)
        form.reset()
      },
      onError: (err) => {
        toast.error(err.message || 'Failed to save storage')
      },
    })
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Storage' : 'Add Storage'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="grid gap-4 py-2">
          <Field label="Title" error={form.formState.errors.title?.message as string}>
            <Input {...form.register('title')} placeholder="My S3 Storage" />
          </Field>

          <Field label="Mode">
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

          <Field label="Bucket" error={form.formState.errors.bucket?.message as string}>
            <Input {...form.register('bucket')} placeholder="my-bucket" />
          </Field>

          <Field label="Endpoint" error={form.formState.errors.endpoint?.message as string}>
            <Input
              {...form.register('endpoint')}
              placeholder="https://xxx.r2.cloudflarestorage.com"
            />
          </Field>

          <Field label="Region">
            <Input {...form.register('region')} placeholder="auto" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Access Key" error={form.formState.errors.accessKey?.message as string}>
              <Input {...form.register('accessKey')} />
            </Field>
            <Field label="Secret Key" error={form.formState.errors.secretKey?.message as string}>
              <Input type="password" {...form.register('secretKey')} />
            </Field>
          </div>

          <Field label="File Path Template">
            <Input {...form.register('filePath')} />
            <p className="text-xs text-muted-foreground mt-1">
              Variables: $UID (user ID), $RAW_NAME (original filename)
            </p>
          </Field>

          {form.watch('mode') === 'public' && (
            <Field label="Custom Host (CDN)">
              <Input {...form.register('customHost')} placeholder="https://cdn.example.com" />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Capacity (bytes)">
              <Input
                type="number"
                {...form.register('capacityBytes', { valueAsNumber: true })}
                placeholder="Leave empty for unlimited"
              />
            </Field>
            <Field label="Priority">
              <Input
                type="number"
                {...form.register('priority', { valueAsNumber: true })}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground mt-1">Lower = used first</p>
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
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
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
