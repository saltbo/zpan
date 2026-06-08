import { zodResolver } from '@hookform/resolvers/zod'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_PROVIDERS,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
  type CaptchaProvider,
} from '@shared/captcha'
import { SignupMode } from '@shared/constants'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Globe2, ShieldCheck } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { siteOptionsQueryKey, useSiteOptions } from '@/hooks/use-site-options'
import { useEntitlement } from '@/hooks/useEntitlement'
import { setSystemOption } from '@/lib/api'

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
  quotaValue: z.coerce.number<number>().positive('Quota must be a positive number'),
  quotaUnit: z.enum(['MB', 'GB']),
  registrationsEnabled: z.boolean(),
  captchaEnabled: z.boolean(),
  captchaProvider: z.enum(CAPTCHA_PROVIDERS),
  captchaSiteKey: z.string(),
  captchaSecretKey: z.string(),
  captchaMinScore: z.string(),
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
  const {
    siteName,
    siteDescription,
    defaultOrgQuota: quotaBytes,
    authSignupMode,
    captchaEnabled,
    captchaProvider,
    captchaSiteKey,
    captchaSecretKey,
    captchaMinScore,
    isLoading,
  } = useSiteOptions()
  const { hasFeature } = useEntitlement()
  const hasWhiteLabel = hasFeature('white_label')
  const hasOpenRegistration = hasFeature('open_registration')

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      siteName: '',
      siteDescription: '',
      quotaValue: 0,
      quotaUnit: 'MB',
      registrationsEnabled: false,
      captchaEnabled: false,
      captchaProvider: 'cloudflare-turnstile',
      captchaSiteKey: '',
      captchaSecretKey: '',
      captchaMinScore: '',
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
      captchaEnabled,
      captchaProvider,
      captchaSiteKey,
      captchaSecretKey,
      captchaMinScore,
    })
  }, [
    isLoading,
    siteName,
    siteDescription,
    quotaBytes,
    authSignupMode,
    captchaEnabled,
    captchaProvider,
    captchaSiteKey,
    captchaSecretKey,
    captchaMinScore,
    form,
  ])

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
      const values = form.getValues()
      if (!Number.isFinite(values.quotaValue) || values.quotaValue <= 0) {
        form.setError('quotaValue', { message: t('admin.settings.positiveQuotaRequired') })
        throw new Error(t('admin.settings.positiveQuotaRequired'))
      }
      const unit =
        values.quotaUnit === 'MB' || values.quotaUnit === 'GB' ? values.quotaUnit : bytesToDisplay(quotaBytes).unit
      const bytes = Math.round(values.quotaValue * UNITS[unit])
      await setSystemOption('default_org_quota', String(bytes), false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
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

  const captchaMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger(['captchaEnabled', 'captchaSiteKey', 'captchaSecretKey'])
      if (!valid) throw new Error(t('admin.settings.captchaInvalid'))
      const values = form.getValues()
      await setSystemOption(CAPTCHA_PROVIDER_KEY, values.captchaProvider, true)
      await setSystemOption(CAPTCHA_SITE_KEY_KEY, values.captchaSiteKey.trim(), true)
      await setSystemOption(CAPTCHA_SECRET_OPTION_KEY, values.captchaSecretKey.trim(), false)
      await setSystemOption(CAPTCHA_MIN_SCORE_KEY, values.captchaMinScore.trim(), false)
      await setSystemOption(CAPTCHA_ENABLED_KEY, String(values.captchaEnabled), true)
    },
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
  const registrationsEnabled = form.watch('registrationsEnabled')
  const captchaProtectionEnabled = form.watch('captchaEnabled')
  const selectedCaptchaProvider = form.watch('captchaProvider')

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

        <Card className="border-border/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-border/60 bg-emerald-500/10 p-2 text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <CardTitle>{t('admin.settings.captchaTitle')}</CardTitle>
                <CardDescription>{t('admin.settings.captchaDescription')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background p-4">
              <div className="space-y-1">
                <Label htmlFor="captchaEnabled">{t('admin.settings.captchaEnabled')}</Label>
                <p className="text-xs leading-5 text-muted-foreground">{t('admin.settings.captchaEnabledHint')}</p>
              </div>
              <Switch
                id="captchaEnabled"
                checked={captchaProtectionEnabled}
                disabled={captchaMutation.isPending}
                onCheckedChange={(checked) => form.setValue('captchaEnabled', checked, { shouldDirty: true })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="captchaProvider">{t('admin.settings.captchaProvider')}</Label>
              <Select
                value={selectedCaptchaProvider}
                onValueChange={(provider: CaptchaProvider) =>
                  form.setValue('captchaProvider', provider, { shouldDirty: true })
                }
              >
                <SelectTrigger id="captchaProvider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cloudflare-turnstile">{t('admin.settings.captchaProviderTurnstile')}</SelectItem>
                  <SelectItem value="google-recaptcha">{t('admin.settings.captchaProviderRecaptcha')}</SelectItem>
                  <SelectItem value="hcaptcha">{t('admin.settings.captchaProviderHcaptcha')}</SelectItem>
                  <SelectItem value="captchafox">{t('admin.settings.captchaProviderCaptchafox')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('admin.settings.captchaProviderHint')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="captchaSiteKey">{t('admin.settings.captchaSiteKey')}</Label>
                <Input
                  id="captchaSiteKey"
                  placeholder={t('admin.settings.captchaSiteKeyPlaceholder')}
                  {...form.register('captchaSiteKey')}
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.captchaSiteKeyHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="captchaSecretKey">{t('admin.settings.captchaSecretKey')}</Label>
                <Input
                  id="captchaSecretKey"
                  type="password"
                  placeholder={t('admin.settings.captchaSecretKeyPlaceholder')}
                  {...form.register('captchaSecretKey')}
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.captchaSecretKeyHint')}</p>
              </div>
            </div>

            {selectedCaptchaProvider === 'google-recaptcha' && (
              <div className="space-y-2">
                <Label htmlFor="captchaMinScore">{t('admin.settings.captchaMinScore')}</Label>
                <Input
                  id="captchaMinScore"
                  inputMode="decimal"
                  placeholder={t('admin.settings.captchaMinScorePlaceholder')}
                  {...form.register('captchaMinScore')}
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.captchaMinScoreHint')}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button type="button" disabled={captchaMutation.isPending} onClick={() => captchaMutation.mutate()}>
                {captchaMutation.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <StorageSettingsSection
          quotaUnit={quotaUnit}
          quotaError={form.formState.errors.quotaValue?.message}
          quotaInputProps={form.register('quotaValue')}
          pending={storageMutation.isPending}
          onQuotaUnitChange={(unit) => form.setValue('quotaUnit', unit)}
          onSave={() => storageMutation.mutate()}
        />
      </form>

      <BrandingSection />
    </div>
  )
}
