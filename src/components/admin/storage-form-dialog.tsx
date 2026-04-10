import { zodResolver } from '@hookform/resolvers/zod'
import type { Storage } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createStorage, updateStorage } from '@/lib/api'

const storageFormSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  filePath: z.string().min(1),
  customHost: z.string().optional(),
})

type StorageFormValues = z.infer<typeof storageFormSchema>

const DEFAULT_VALUES: StorageFormValues = {
  title: '',
  mode: 'private',
  bucket: '',
  endpoint: '',
  region: 'auto',
  accessKey: '',
  secretKey: '',
  filePath: '$UID/$RAW_NAME',
  customHost: '',
}

interface StorageFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage: Storage | null
}

export function StorageFormDialog({ open, onOpenChange, storage }: StorageFormDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showSecret, setShowSecret] = useState(false)
  const isEditing = storage !== null

  const form = useForm<StorageFormValues>({
    resolver: zodResolver(storageFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!open) return
    if (storage) {
      form.reset({
        title: storage.title,
        mode: storage.mode,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        filePath: storage.filePath,
        customHost: storage.customHost || '',
      })
    } else {
      form.reset(DEFAULT_VALUES)
    }
    setShowSecret(false)
  }, [open, storage, form])

  const mutation = useMutation({
    mutationFn: (values: StorageFormValues) =>
      isEditing ? updateStorage(storage.id, values) : createStorage({ ...values, capacity: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'storages'] })
      onOpenChange(false)
      toast.success(isEditing ? t('admin.storages.updated') : t('admin.storages.created'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function onSubmit(values: StorageFormValues) {
    mutation.mutate(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('admin.storages.editTitle') : t('admin.storages.addTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4">
            <FormField label={t('admin.storages.fieldTitle')} error={form.formState.errors.title?.message}>
              <Input {...form.register('title')} />
            </FormField>

            <FormField label={t('admin.storages.fieldMode')} error={form.formState.errors.mode?.message}>
              <select
                {...form.register('mode')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="private">{t('admin.storages.modePrivate')}</option>
                <option value="public">{t('admin.storages.modePublic')}</option>
              </select>
            </FormField>

            <FormField label={t('admin.storages.fieldBucket')} error={form.formState.errors.bucket?.message}>
              <Input {...form.register('bucket')} />
            </FormField>

            <FormField label={t('admin.storages.fieldEndpoint')} error={form.formState.errors.endpoint?.message}>
              <Input {...form.register('endpoint')} placeholder="https://s3.amazonaws.com" />
            </FormField>

            <FormField label={t('admin.storages.fieldRegion')} error={form.formState.errors.region?.message}>
              <Input {...form.register('region')} placeholder="auto" />
            </FormField>

            <FormField label={t('admin.storages.fieldAccessKey')} error={form.formState.errors.accessKey?.message}>
              <Input {...form.register('accessKey')} />
            </FormField>

            <FormField label={t('admin.storages.fieldSecretKey')} error={form.formState.errors.secretKey?.message}>
              <div className="relative">
                <Input {...form.register('secretKey')} type={showSecret ? 'text' : 'password'} className="pr-10" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowSecret((v) => !v)}
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </FormField>

            <FormField label={t('admin.storages.fieldFilePath')} error={form.formState.errors.filePath?.message}>
              <Input {...form.register('filePath')} placeholder="$UID/$RAW_NAME" />
            </FormField>

            <FormField label={t('admin.storages.fieldCustomHost')} error={form.formState.errors.customHost?.message}>
              <Input {...form.register('customHost')} placeholder={t('admin.storages.customHostPlaceholder')} />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FormField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
