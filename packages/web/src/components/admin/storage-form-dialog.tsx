import { zodResolver } from '@hookform/resolvers/zod'
import type { Storage } from '@zpan/shared/types'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const storageSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().min(1),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  filePath: z.string().min(1),
  customHost: z.string().optional(),
  capacity: z.coerce.number().min(1),
})

export type StorageFormValues = z.infer<typeof storageSchema>

const defaultValues: StorageFormValues = {
  title: '',
  mode: 'private',
  bucket: '',
  endpoint: '',
  region: '',
  accessKey: '',
  secretKey: '',
  filePath: '{uid}/{date}/{filename}{ext}',
  customHost: '',
  capacity: 100,
}

interface StorageFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage?: Storage
  onSubmit: (values: StorageFormValues) => void
  loading?: boolean
}

function storageToFormValues(storage: StorageWithCapacity): StorageFormValues {
  return {
    title: storage.title,
    mode: storage.mode,
    bucket: storage.bucket,
    endpoint: storage.endpoint,
    region: storage.region,
    accessKey: storage.accessKey,
    secretKey: storage.secretKey,
    filePath: storage.filePath,
    customHost: storage.customHost || '',
    capacity: storage.capacity ?? 100,
  }
}

// The Storage type doesn't have capacity yet — the backend will add it.
// This extended type lets the form handle both old and new API shapes.
type StorageWithCapacity = Storage & { capacity?: number }

export function StorageFormDialog({ open, onOpenChange, storage, onSubmit, loading }: StorageFormDialogProps) {
  const { t } = useTranslation()
  const [showSecret, setShowSecret] = useState(false)

  const form = useForm<StorageFormValues>({
    resolver: zodResolver(storageSchema),
    defaultValues,
  })
  const { reset } = form

  useEffect(() => {
    if (open) {
      reset(storage ? storageToFormValues(storage) : defaultValues)
      setShowSecret(false)
    }
  }, [open, storage, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{storage ? t('admin.storages.editStorage') : t('admin.storages.addStorage')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField label={t('admin.storages.form.title')} error={form.formState.errors.title?.message}>
            <Input {...form.register('title')} />
          </FormField>

          <div className="space-y-2">
            <Label>{t('admin.storages.form.mode')}</Label>
            <Select value={form.watch('mode')} onValueChange={(v) => form.setValue('mode', v as 'private' | 'public')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">{t('admin.storages.form.modePrivate')}</SelectItem>
                <SelectItem value="public">{t('admin.storages.form.modePublic')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <FormField label={t('admin.storages.form.bucket')} error={form.formState.errors.bucket?.message}>
            <Input {...form.register('bucket')} />
          </FormField>

          <FormField label={t('admin.storages.form.endpoint')} error={form.formState.errors.endpoint?.message}>
            <Input {...form.register('endpoint')} placeholder="https://s3.amazonaws.com" />
          </FormField>

          <FormField label={t('admin.storages.form.region')} error={form.formState.errors.region?.message}>
            <Input {...form.register('region')} placeholder="us-east-1" />
          </FormField>

          <FormField label={t('admin.storages.form.accessKey')} error={form.formState.errors.accessKey?.message}>
            <Input {...form.register('accessKey')} />
          </FormField>

          <div className="space-y-2">
            <Label>{t('admin.storages.form.secretKey')}</Label>
            <div className="relative">
              <Input {...form.register('secretKey')} type={showSecret ? 'text' : 'password'} className="pr-10" />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecret(!showSecret)}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.secretKey?.message && (
              <p className="text-sm text-destructive">{form.formState.errors.secretKey.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t('admin.storages.form.filePath')}</Label>
            <Input {...form.register('filePath')} />
            <p className="text-xs text-muted-foreground">{t('admin.storages.form.filePathHint')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('admin.storages.form.customHost')}</Label>
            <Input {...form.register('customHost')} placeholder="https://cdn.example.com" />
            <p className="text-xs text-muted-foreground">{t('admin.storages.form.customHostHint')}</p>
          </div>

          <FormField label={t('admin.storages.form.capacity')} error={form.formState.errors.capacity?.message}>
            <Input {...form.register('capacity')} type="number" min={1} />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
