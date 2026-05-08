import { zodResolver } from '@hookform/resolvers/zod'
import { SignupMode } from '@shared/constants'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Globe2 } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { BrandingSection } from '@/components/admin/branding-section'
import { type StorageQuotaUnit, StorageSettingsSection } from '@/components/admin/cloud-store-settings-section'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { useEntitlement } from '@/hooks/useEntitlement'
import { getCloudStoreSettings, setSystemOption, updateCloudStoreSettings } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const UNITS: Record<StorageQuotaUnit, number> = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }

function bytesToDisplay(bytes: number): { value: number; unit: StorageQuotaUnit } {
  if (bytes >= UNITS.GB && bytes % UNITS.GB === 0) return { value: bytes / UNITS.GB, unit: 'GB' }
  return { value: bytes / UNITS.MB, unit: 'MB' }
}

const settingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string(),
  quotaValue: z.coerce.number().positive('Quota must be a positive number'),
  quotaUnit: z.enum(['MB', 'GB']),
  cloudStoreEnabled: z.boolean(),
  registrationsEnabled: z.boolean(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

function ProFeatureHeader({ title, description, tooltip }: { title: string; description: string; tooltip: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CardTitle>{title}</CardTitle>
        <ProBadge tooltip={tooltip} />
      </div>
      <CardDescription>{description}</CardDescription>
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { siteName, siteDescription, defaultOrgQuota: quotaBytes, authSignupMode, isLoading } = useSiteOptions()
  const { hasFeature } = useEntitlement()
  const hasWhiteLabel = hasFeature('white_label')
  const hasOpenRegistration = hasFeature('open_registration')
  const hasCloudStore = hasFeature('quota_store')
  const cloudStoreQuery = useQuery({
    queryKey: ['admin', 'cloud-store', 'settings'],
    queryFn: getCloudStoreSettings,
    enabled: hasCloudStore,
    retry: false,
  })

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      siteName: '',
      siteDescription: '',
      quotaValue: 0,
      quotaUnit: 'MB',
      cloudStoreEnabled: false,
      registrationsEnabled: false,
    },
  })

  useEffect(() => {
    if (isLoading) return
    const { value, unit } = bytesToDisplay(quotaBytes)
    form.reset({
      siteName,
      siteDescription,
      quotaValue: value,
      quotaUnit: unit,
      cloudStoreEnabled: cloudStoreQuery.data?.enabled ?? false,
      registrationsEnabled: authSignupMode === SignupMode.OPEN,
    })
  }, [isLoading, siteName, siteDescription, quotaBytes, cloudStoreQuery.data, authSignupMode, form])

  const identityMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger(['siteName', 'siteDescription'])
      if (!valid) throw new Error(t('admin.settings.identityInvalid'))
      const values = form.getValues()
      await setSystemOption('site_name', values.siteName, true)
      await setSystemOption('site_description', values.siteDescription, true)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const storageMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger(['quotaValue', 'quotaUnit'])
      if (!valid) throw new Error(t('admin.settings.positiveQuotaRequired'))
      const values = form.getValues()
      const bytes = Math.round(values.quotaValue * UNITS[values.quotaUnit])
      await setSystemOption('default_org_quota', String(bytes), false)
      if (hasCloudStore) await updateCloudStoreSettings({ enabled: values.cloudStoreEnabled })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store', 'settings'] })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'cloud-store', 'settings'] })
      toast.error(err.message)
    },
  })

  const registrationMutation = useMutation({
    mutationFn: (checked: boolean) =>
      setSystemOption('auth_signup_mode', checked ? SignupMode.OPEN : SignupMode.CLOSED, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.error(err.message)
    },
  })

  const quotaUnit = form.watch('quotaUnit')
  const cloudStoreEnabled = form.watch('cloudStoreEnabled')
  const registrationsEnabled = form.watch('registrationsEnabled')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <form id="site-settings-form" className="space-y-6">
        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
                <Globe2 className="h-5 w-5" />
              </div>
              <ProFeatureHeader
                title={t('admin.settings.identityTitle')}
                description={t('admin.settings.identityDescription')}
                tooltip={t('admin.settings.identityProTooltip')}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className={`space-y-2 ${!hasWhiteLabel ? 'opacity-60' : ''}`}>
              <Label htmlFor="siteName">{t('admin.settings.siteName')}</Label>
              <Input
                id="siteName"
                readOnly={!hasWhiteLabel}
                aria-disabled={!hasWhiteLabel}
                tabIndex={!hasWhiteLabel ? -1 : undefined}
                placeholder={t('admin.settings.siteNamePlaceholder')}
                {...form.register('siteName')}
              />
              <p className="text-xs text-muted-foreground">{t('admin.settings.siteNameHint')}</p>
              {form.formState.errors.siteName && (
                <p className="text-xs text-destructive">{form.formState.errors.siteName.message}</p>
              )}
            </div>

            <div className={`space-y-2 ${!hasWhiteLabel ? 'opacity-60' : ''}`}>
              <Label htmlFor="siteDescription">{t('admin.settings.siteDescription')}</Label>
              <Textarea
                id="siteDescription"
                rows={4}
                readOnly={!hasWhiteLabel}
                aria-disabled={!hasWhiteLabel}
                tabIndex={!hasWhiteLabel ? -1 : undefined}
                placeholder={t('admin.settings.siteDescriptionPlaceholder')}
                {...form.register('siteDescription')}
              />
              <p className="text-xs text-muted-foreground">{t('admin.settings.siteDescriptionHint')}</p>
              {form.formState.errors.siteDescription && (
                <p className="text-xs text-destructive">{form.formState.errors.siteDescription.message}</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                disabled={!hasWhiteLabel || identityMutation.isPending}
                onClick={() => identityMutation.mutate()}
              >
                {identityMutation.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-amber-500/10 p-2 text-amber-600">
                <Globe2 className="h-5 w-5" />
              </div>
              <ProFeatureHeader
                title={t('admin.settings.registrationTitle')}
                description={t('admin.settings.registrationDescription')}
                tooltip={t('admin.settings.registrationUpgradeHint')}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background p-4">
              <div className="space-y-1">
                <Label htmlFor="registrationsEnabled">{t('admin.settings.registrationLabel')}</Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {registrationsEnabled
                    ? t('admin.settings.registrationHintOpen')
                    : t('admin.settings.registrationHintClosed')}
                </p>
              </div>
              <Switch
                id="registrationsEnabled"
                checked={registrationsEnabled}
                disabled={!hasOpenRegistration || registrationMutation.isPending}
                onCheckedChange={(checked) => {
                  form.setValue('registrationsEnabled', checked, { shouldDirty: true })
                  registrationMutation.mutate(checked)
                }}
              />
            </div>
          </CardContent>
        </Card>

        <StorageSettingsSection
          hasCloudStore={hasCloudStore}
          quotaUnit={quotaUnit}
          cloudStoreEnabled={cloudStoreEnabled}
          quotaError={form.formState.errors.quotaValue?.message}
          quotaInputProps={form.register('quotaValue')}
          pending={storageMutation.isPending}
          cloudStoreLoading={cloudStoreQuery.isLoading}
          onQuotaUnitChange={(unit) => form.setValue('quotaUnit', unit)}
          onSave={() => storageMutation.mutate()}
          onCloudStoreChange={(checked) => {
            form.setValue('cloudStoreEnabled', checked, { shouldDirty: true })
          }}
        />
      </form>

      <BrandingSection />
    </div>
  )
}
