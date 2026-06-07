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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { createStorage, updateStorage } from '@/lib/api'
import { formatSize } from '@/lib/format'

const UNITS = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof UNITS

function bytesToDisplay(bytes: number): { value: number; unit: Unit } {
  if (bytes === 0) return { value: 0, unit: 'GB' }
  if (bytes >= UNITS.TB && bytes % UNITS.TB === 0) return { value: bytes / UNITS.TB, unit: 'TB' }
  if (bytes >= UNITS.GB && bytes % UNITS.GB === 0) return { value: bytes / UNITS.GB, unit: 'GB' }
  return { value: bytes / UNITS.MB, unit: 'MB' }
}

const storageFormSchema = z.object({
  title: z.string().min(1),
  mode: z.enum(['private', 'public']),
  bucket: z.string().min(1),
  endpoint: z.string().url(),
  region: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  customHost: z.string().optional(),
  capacityValue: z.coerce.number<number>().min(0),
  capacityUnit: z.enum(['MB', 'GB', 'TB']),
  egressCreditBillingEnabled: z.boolean(),
  egressCreditUnitValue: z.coerce.number<number>().min(1),
  egressCreditUnit: z.enum(['MB', 'GB', 'TB']),
  egressCreditPerUnit: z.coerce.number<number>().int().min(1),
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
  customHost: '',
  capacityValue: 0,
  capacityUnit: 'GB',
  egressCreditBillingEnabled: false,
  egressCreditUnitValue: 100,
  egressCreditUnit: 'MB',
  egressCreditPerUnit: 1,
}

interface StorageFormDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  storage: Storage | null
  hasTrafficBilling: boolean
}

export function StorageFormDrawer({ open, onOpenChange, storage, hasTrafficBilling }: StorageFormDrawerProps) {
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
      const { value, unit } = bytesToDisplay(storage.capacity ?? 0)
      const egressUnit = bytesToDisplay(storage.egressCreditUnitBytes ?? UNITS.MB * 100)
      form.reset({
        title: storage.title,
        mode: storage.mode,
        bucket: storage.bucket,
        endpoint: storage.endpoint,
        region: storage.region,
        accessKey: storage.accessKey,
        secretKey: storage.secretKey,
        customHost: storage.customHost || '',
        capacityValue: value,
        capacityUnit: unit,
        egressCreditBillingEnabled: hasTrafficBilling ? (storage.egressCreditBillingEnabled ?? false) : false,
        egressCreditUnitValue: egressUnit.value,
        egressCreditUnit: egressUnit.unit,
        egressCreditPerUnit: storage.egressCreditPerUnit ?? 1,
      })
    } else {
      form.reset({ ...DEFAULT_VALUES, egressCreditBillingEnabled: false })
    }
    setShowSecret(false)
  }, [open, storage, form, hasTrafficBilling])

  const mutation = useMutation({
    mutationFn: ({
      capacityValue,
      capacityUnit,
      egressCreditUnitValue,
      egressCreditUnit,
      ...rest
    }: StorageFormValues) => {
      const capacity = capacityValue * UNITS[capacityUnit]
      const egressCreditUnitBytes = egressCreditUnitValue * UNITS[egressCreditUnit]
      const payload = {
        ...rest,
        egressCreditBillingEnabled: hasTrafficBilling ? rest.egressCreditBillingEnabled : false,
        capacity,
        egressCreditUnitBytes,
      }
      return isEditing ? updateStorage(storage.id, payload) : createStorage(payload)
    },
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isEditing ? t('admin.storages.editTitle') : t('admin.storages.addTitle')}</SheetTitle>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4">
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

              <FormField label={t('admin.storages.fieldCustomHost')} error={form.formState.errors.customHost?.message}>
                <Input {...form.register('customHost')} placeholder={t('admin.storages.customHostPlaceholder')} />
              </FormField>

              <FormField label={t('admin.storages.fieldCapacity')} error={form.formState.errors.capacityValue?.message}>
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} step={1} className="w-32" {...form.register('capacityValue')} />
                  <Select
                    value={form.watch('capacityUnit')}
                    onValueChange={(v) => form.setValue('capacityUnit', v as Unit)}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                      <SelectItem value="TB">TB</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    {form.watch('capacityValue') > 0
                      ? `= ${formatSize(form.watch('capacityValue') * UNITS[form.watch('capacityUnit')])}`
                      : t('admin.storages.capacityUnlimited')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t('admin.storages.capacityHint')}</p>
              </FormField>

              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label htmlFor="egressCreditBillingEnabled">{t('admin.storages.egressBilling')}</Label>
                    <p className="text-xs text-muted-foreground">{t('admin.storages.egressBillingHint')}</p>
                  </div>
                  <Switch
                    id="egressCreditBillingEnabled"
                    disabled={!hasTrafficBilling}
                    checked={form.watch('egressCreditBillingEnabled')}
                    onCheckedChange={(checked) =>
                      form.setValue('egressCreditBillingEnabled', hasTrafficBilling && checked)
                    }
                  />
                </div>
                {!hasTrafficBilling && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('admin.storages.egressBillingBusinessOnly')}</p>
                )}
                {form.watch('egressCreditBillingEnabled') && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <FormField
                      label={t('admin.storages.egressBillingUnit')}
                      error={form.formState.errors.egressCreditUnitValue?.message}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          className="w-28"
                          {...form.register('egressCreditUnitValue')}
                        />
                        <Select
                          value={form.watch('egressCreditUnit')}
                          onValueChange={(v) => form.setValue('egressCreditUnit', v as Unit)}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MB">MB</SelectItem>
                            <SelectItem value="GB">GB</SelectItem>
                            <SelectItem value="TB">TB</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </FormField>
                    <FormField
                      label={t('admin.storages.egressBillingCredits')}
                      error={form.formState.errors.egressCreditPerUnit?.message}
                    >
                      <Input type="number" min={1} step={1} {...form.register('egressCreditPerUnit')} />
                    </FormField>
                  </div>
                )}
              </div>
            </div>
          </div>

          <SheetFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
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
