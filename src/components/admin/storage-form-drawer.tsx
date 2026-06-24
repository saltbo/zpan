import { zodResolver } from '@hookform/resolvers/zod'
import type { Storage } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { createStorage, updateStorage } from '@/lib/api'

const storageFormSchema = z.object({
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  forcePathStyle: z.boolean(),
})

type StorageFormValues = z.infer<typeof storageFormSchema>

const DEFAULT_VALUES: StorageFormValues = {
  bucket: '',
  endpoint: '',
  region: 'auto',
  accessKey: '',
  secretKey: '',
  customHost: '',
  forcePathStyle: true,
}

interface StorageFormDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage: Storage | null
}

export function StorageFormDrawer({ open, onOpenChange, storage }: StorageFormDrawerProps) {
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
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        customHost: storage.customHost || '',
        forcePathStyle: storage.forcePathStyle ?? true,
      })
    } else {
      form.reset(DEFAULT_VALUES)
    }
    setShowSecret(false)
  }, [open, storage, form])

  const mutation = useMutation({
    mutationFn: (values: StorageFormValues) => (isEditing ? updateStorage(storage.id, values) : createStorage(values)),
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
    <AdminFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? t('admin.storages.editTitle') : t('admin.storages.addTitle')}
      bodyClassName="grid auto-rows-min content-start gap-4"
      formProps={{ onSubmit: form.handleSubmit(onSubmit) }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </>
      }
    >
      <AdminFormField
        id="storage-bucket"
        label={t('admin.storages.fieldBucket')}
        required
        error={form.formState.errors.bucket?.message}
      >
        <Input {...form.register('bucket')} placeholder={t('admin.storages.bucketPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-endpoint"
        label={t('admin.storages.fieldEndpoint')}
        required
        error={form.formState.errors.endpoint?.message}
      >
        <Input {...form.register('endpoint')} placeholder={t('admin.storages.endpointPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-region"
        label={t('admin.storages.fieldRegion')}
        required
        error={form.formState.errors.region?.message}
      >
        <Input {...form.register('region')} placeholder={t('admin.storages.regionPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-access-key"
        label={t('admin.storages.fieldAccessKey')}
        required
        error={form.formState.errors.accessKey?.message}
      >
        <Input {...form.register('accessKey')} placeholder={t('admin.storages.accessKeyPlaceholder')} />
      </AdminFormField>

      <AdminFormField
        id="storage-secret-key"
        label={t('admin.storages.fieldSecretKey')}
        required
        error={form.formState.errors.secretKey?.message}
      >
        {(controlProps) => (
          <div className="relative">
            <Input
              {...form.register('secretKey')}
              {...controlProps}
              type={showSecret ? 'text' : 'password'}
              placeholder={t('admin.storages.secretKeyPlaceholder')}
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={showSecret ? t('admin.storages.hideSecretKey') : t('admin.storages.showSecretKey')}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </AdminFormField>

      <AdminFormField
        id="storage-custom-host"
        label={t('admin.storages.fieldCustomHost')}
        help={t('admin.storages.customHostHint')}
        error={form.formState.errors.customHost?.message}
      >
        <Input {...form.register('customHost')} placeholder={t('admin.storages.customHostPlaceholder')} />
      </AdminFormField>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <AdminFormLabel htmlFor="forcePathStyle" help={t('admin.storages.forcePathStyleHint')}>
            {t('admin.storages.fieldForcePathStyle')}
          </AdminFormLabel>
        </div>
        <Switch
          id="forcePathStyle"
          className="mt-0.5"
          checked={form.watch('forcePathStyle')}
          onCheckedChange={(checked) => form.setValue('forcePathStyle', checked)}
        />
      </div>
    </AdminFormDrawer>
  )
}
