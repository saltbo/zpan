import { zodResolver } from '@hookform/resolvers/zod'
import { SignupMode } from '@shared/constants'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Globe2, HardDrive } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { BrandingSection } from '@/components/admin/branding-section'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { useEntitlement } from '@/hooks/useEntitlement'
import { setSystemOption } from '@/lib/api'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/admin/settings/')({
  component: SettingsPage,
})

const UNITS = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024 } as const
type Unit = keyof typeof UNITS

function bytesToDisplay(bytes: number): { value: number; unit: Unit } {
  if (bytes >= UNITS.GB && bytes % UNITS.GB === 0) return { value: bytes / UNITS.GB, unit: 'GB' }
  return { value: bytes / UNITS.MB, unit: 'MB' }
}

const settingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string(),
  quotaValue: z.coerce.number().min(0),
  quotaUnit: z.enum(['MB', 'GB']),
  registrationsEnabled: z.boolean(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>

function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { siteName, siteDescription, defaultOrgQuota: quotaBytes, authSignupMode, isLoading } = useSiteOptions()
  const { hasFeature } = useEntitlement()
  const hasOpenRegistration = hasFeature('open_registration')

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      siteName: '',
      siteDescription: '',
      quotaValue: 0,
      quotaUnit: 'MB' as Unit,
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
      registrationsEnabled: authSignupMode === SignupMode.OPEN,
    })
  }, [isLoading, siteName, siteDescription, quotaBytes, authSignupMode, form])

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      await setSystemOption('site_name', values.siteName, true)
      await setSystemOption('site_description', values.siteDescription, true)
      const bytes = values.quotaValue * UNITS[values.quotaUnit]
      await setSystemOption('default_org_quota', String(bytes), false)
      await setSystemOption('auth_signup_mode', values.registrationsEnabled ? SignupMode.OPEN : SignupMode.CLOSED, true)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const quotaValue = form.watch('quotaValue')
  const quotaUnit = form.watch('quotaUnit')
  const quotaDisplayBytes = quotaValue * UNITS[quotaUnit]
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
      <form id="site-settings-form" onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-6">
        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
                <Globe2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{t('admin.settings.identityTitle')}</CardTitle>
                <CardDescription>{t('admin.settings.identityDescription')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="siteName">{t('admin.settings.siteName')}</Label>
              <Input
                id="siteName"
                placeholder={t('admin.settings.siteNamePlaceholder')}
                {...form.register('siteName')}
              />
              <p className="text-xs text-muted-foreground">{t('admin.settings.siteNameHint')}</p>
              {form.formState.errors.siteName && (
                <p className="text-xs text-destructive">{form.formState.errors.siteName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="siteDescription">{t('admin.settings.siteDescription')}</Label>
              <Textarea
                id="siteDescription"
                rows={4}
                placeholder={t('admin.settings.siteDescriptionPlaceholder')}
                {...form.register('siteDescription')}
              />
              <p className="text-xs text-muted-foreground">{t('admin.settings.siteDescriptionHint')}</p>
              {form.formState.errors.siteDescription && (
                <p className="text-xs text-destructive">{form.formState.errors.siteDescription.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-amber-500/10 p-2 text-amber-600">
                <Globe2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{t('admin.settings.registrationTitle')}</CardTitle>
                <CardDescription>{t('admin.settings.registrationDescription')}</CardDescription>
              </div>
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
                {!hasOpenRegistration && (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t('admin.settings.registrationUpgradeHint')}
                  </p>
                )}
              </div>
              <Switch
                id="registrationsEnabled"
                checked={registrationsEnabled}
                disabled={!hasOpenRegistration}
                onCheckedChange={(checked) => form.setValue('registrationsEnabled', checked, { shouldDirty: true })}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-emerald-500/10 p-2 text-emerald-600">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{t('admin.settings.quotaSection')}</CardTitle>
                <CardDescription>{t('admin.settings.quotaDescription')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quotaValue">{t('admin.settings.defaultOrgQuota')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="quotaValue"
                  type="number"
                  min={0}
                  step={1}
                  className="flex-1"
                  {...form.register('quotaValue')}
                />
                <Select value={quotaUnit} onValueChange={(v) => form.setValue('quotaUnit', v as Unit)}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MB">MB</SelectItem>
                    <SelectItem value="GB">GB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/30 px-4 py-3">
                <p className="text-sm font-medium">
                  {quotaDisplayBytes === 0 ? t('admin.settings.unlimited') : formatSize(quotaDisplayBytes)}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t('admin.settings.defaultOrgQuotaHint')}
                </p>
              </div>
              {form.formState.errors.quotaValue && (
                <p className="text-xs text-destructive">{form.formState.errors.quotaValue.message}</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('admin.settings.brandingTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('admin.settings.brandingDescription')}</p>
        </div>
        <BrandingSection />
      </div>
    </div>
  )
}
