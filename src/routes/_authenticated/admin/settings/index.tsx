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
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { BrandingSection } from '@/components/admin/branding-section'
import type { StorageQuotaUnit } from '@/components/admin/cloud-store-settings-section'
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
  sitePublicOrigin: z
    .string()
    .trim()
    .refine((value) => value === '' || /^https?:\/\/[^/]+/.test(value), 'Site URL must start with http:// or https://'),
  quotaValue: z.coerce.number<number>().positive('Quota must be a positive number'),
  quotaUnit: z.enum(['MB', 'GB']),
  teamQuotaValue: z.coerce.number<number>().positive('Quota must be a positive number'),
  teamQuotaUnit: z.enum(['MB', 'GB']),
  registrationsEnabled: z.boolean(),
  captchaEnabled: z.boolean(),
  captchaProvider: z.enum(CAPTCHA_PROVIDERS),
  captchaSiteKey: z.string(),
  captchaSecretKey: z.string(),
  captchaMinScore: z.string(),
})

type SettingsFormValues = z.infer<typeof settingsSchema>
type SettingsDrawer = 'identity' | 'registration' | 'captcha' | 'storage' | null

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
  const [settingsDrawer, setSettingsDrawer] = useState<SettingsDrawer>(null)
  const {
    siteName,
    siteDescription,
    sitePublicOrigin,
    defaultOrgQuota: quotaBytes,
    defaultTeamQuota: teamQuotaBytes,
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
      sitePublicOrigin: '',
      quotaValue: 0,
      quotaUnit: 'MB',
      teamQuotaValue: 0,
      teamQuotaUnit: 'MB',
      registrationsEnabled: false,
      captchaEnabled: false,
      captchaProvider: 'cloudflare-turnstile',
      captchaSiteKey: '',
      captchaSecretKey: '',
      captchaMinScore: '',
    },
  })

  const savedSettingsValues = useCallback((): SettingsFormValues => {
    const { value, unit } = bytesToDisplay(quotaBytes)
    const { value: teamValue, unit: teamUnit } = bytesToDisplay(teamQuotaBytes)
    return {
      siteName,
      siteDescription,
      sitePublicOrigin,
      quotaValue: value,
      quotaUnit: unit,
      teamQuotaValue: teamValue,
      teamQuotaUnit: teamUnit,
      registrationsEnabled: authSignupMode === SignupMode.OPEN,
      captchaEnabled,
      captchaProvider,
      captchaSiteKey,
      captchaSecretKey,
      captchaMinScore,
    }
  }, [
    siteName,
    siteDescription,
    sitePublicOrigin,
    quotaBytes,
    teamQuotaBytes,
    authSignupMode,
    captchaEnabled,
    captchaProvider,
    captchaSiteKey,
    captchaSecretKey,
    captchaMinScore,
  ])

  const closeSettingsDrawer = useCallback(
    ({ reset = true }: { reset?: boolean } = {}) => {
      setSettingsDrawer(null)
      if (reset) form.reset(savedSettingsValues())
    },
    [form, savedSettingsValues],
  )

  useEffect(() => {
    if (isLoading) return
    form.reset(savedSettingsValues())
  }, [isLoading, form, savedSettingsValues])

  const identityMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger(['siteName', 'siteDescription', 'sitePublicOrigin'])
      if (!valid) throw new Error(t('admin.settings.identityInvalid'))
      const values = form.getValues()
      await setSystemOption('site_name', values.siteName, true)
      await setSystemOption('site_description', values.siteDescription, true)
      await setSystemOption('site_public_origin', values.sitePublicOrigin.trim(), false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      closeSettingsDrawer({ reset: false })
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
      if (!Number.isFinite(values.teamQuotaValue) || values.teamQuotaValue <= 0) {
        form.setError('teamQuotaValue', { message: t('admin.settings.positiveQuotaRequired') })
        throw new Error(t('admin.settings.positiveQuotaRequired'))
      }
      const unit =
        values.quotaUnit === 'MB' || values.quotaUnit === 'GB' ? values.quotaUnit : bytesToDisplay(quotaBytes).unit
      const bytes = Math.round(values.quotaValue * UNITS[unit])
      await setSystemOption('default_org_quota', String(bytes), false)
      const teamUnit =
        values.teamQuotaUnit === 'MB' || values.teamQuotaUnit === 'GB'
          ? values.teamQuotaUnit
          : bytesToDisplay(teamQuotaBytes).unit
      const teamBytes = Math.round(values.teamQuotaValue * UNITS[teamUnit])
      await setSystemOption('default_team_quota', String(teamBytes), false)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      closeSettingsDrawer({ reset: false })
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
      closeSettingsDrawer({ reset: false })
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
      closeSettingsDrawer({ reset: false })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: siteOptionsQueryKey })
      toast.error(err.message)
    },
  })

  const quotaUnit = form.watch('quotaUnit')
  const teamQuotaUnit = form.watch('teamQuotaUnit')
  const registrationsEnabled = form.watch('registrationsEnabled')
  const captchaProtectionEnabled = form.watch('captchaEnabled')
  const selectedCaptchaProvider = form.watch('captchaProvider')
  const savedQuota = bytesToDisplay(quotaBytes)
  const savedTeamQuota = bytesToDisplay(teamQuotaBytes)
  const savedRegistrationsEnabled = authSignupMode === SignupMode.OPEN

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('admin.settings.title')} description={t('admin.settings.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-border/60 bg-primary/10 p-2 text-primary">
                  <Globe2 className="h-5 w-5" />
                </div>
                <ProFeatureHeader
                  title={t('admin.settings.identityTitle')}
                  description={t('admin.settings.identityDescription')}
                  tooltip={t('admin.settings.identityProTooltip')}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setSettingsDrawer('identity')}>
                {t('common.edit')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{siteName}</p>
            <p className="text-muted-foreground">{siteDescription || t('admin.settings.previewFallback')}</p>
            <p className="text-xs text-muted-foreground">
              {sitePublicOrigin || t('admin.settings.sitePublicOriginPlaceholder')}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-border/60 bg-amber-500/10 p-2 text-amber-600">
                  <Globe2 className="h-5 w-5" />
                </div>
                <ProFeatureHeader
                  title={t('admin.settings.registrationTitle')}
                  description={t('admin.settings.registrationDescription')}
                  tooltip={t('admin.settings.registrationUpgradeHint')}
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => setSettingsDrawer('registration')}>
                {t('common.edit')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {savedRegistrationsEnabled
              ? t('admin.settings.registrationHintOpen')
              : t('admin.settings.registrationHintClosed')}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-border/60 bg-emerald-500/10 p-2 text-emerald-600">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle>{t('admin.settings.captchaTitle')}</CardTitle>
                  <CardDescription>{t('admin.settings.captchaDescription')}</CardDescription>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSettingsDrawer('captcha')}>
                {t('common.edit')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {captchaEnabled ? t('admin.settings.captchaProvider') : t('common.disabled')}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg border border-border/60 bg-emerald-500/10 p-2 text-emerald-600">
                  <Globe2 className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle>{t('admin.settings.storageSection')}</CardTitle>
                  <CardDescription>{t('admin.settings.quotaDescription')}</CardDescription>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSettingsDrawer('storage')}>
                {t('common.edit')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              {t('admin.settings.defaultOrgQuota')}: {savedQuota.value} {savedQuota.unit}
            </p>
            <p>
              {t('admin.settings.defaultTeamQuota')}: {savedTeamQuota.value} {savedTeamQuota.unit}
            </p>
          </CardContent>
        </Card>
      </div>

      <BrandingSection />

      <AdminFormDrawer
        open={settingsDrawer === 'identity'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.identityTitle')}
        description={t('admin.settings.identityDescription')}
        bodyClassName="grid gap-5"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={!hasWhiteLabel || identityMutation.isPending}
              onClick={() => identityMutation.mutate()}
            >
              {identityMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <AdminFormField
          id="siteName"
          label={t('admin.settings.siteName')}
          description={t('admin.settings.siteNameHint')}
          error={form.formState.errors.siteName?.message}
          className={!hasWhiteLabel ? 'opacity-60' : undefined}
        >
          <Input
            readOnly={!hasWhiteLabel}
            aria-disabled={!hasWhiteLabel}
            tabIndex={!hasWhiteLabel ? -1 : undefined}
            placeholder={t('admin.settings.siteNamePlaceholder')}
            {...form.register('siteName')}
          />
        </AdminFormField>

        <AdminFormField
          id="siteDescription"
          label={t('admin.settings.siteDescription')}
          description={t('admin.settings.siteDescriptionHint')}
          error={form.formState.errors.siteDescription?.message}
          className={!hasWhiteLabel ? 'opacity-60' : undefined}
        >
          <Textarea
            rows={4}
            readOnly={!hasWhiteLabel}
            aria-disabled={!hasWhiteLabel}
            tabIndex={!hasWhiteLabel ? -1 : undefined}
            placeholder={t('admin.settings.siteDescriptionPlaceholder')}
            {...form.register('siteDescription')}
          />
        </AdminFormField>

        <AdminFormField
          id="sitePublicOrigin"
          label={t('admin.settings.sitePublicOrigin')}
          description={t('admin.settings.sitePublicOriginHint')}
          error={form.formState.errors.sitePublicOrigin?.message}
        >
          <Input placeholder={t('admin.settings.sitePublicOriginPlaceholder')} {...form.register('sitePublicOrigin')} />
        </AdminFormField>
      </AdminFormDrawer>

      <AdminFormDrawer
        open={settingsDrawer === 'registration'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.registrationTitle')}
        description={t('admin.settings.registrationDescription')}
        footer={
          <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
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
      </AdminFormDrawer>

      <AdminFormDrawer
        open={settingsDrawer === 'captcha'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.captchaTitle')}
        description={t('admin.settings.captchaDescription')}
        bodyClassName="grid gap-5"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={captchaMutation.isPending} onClick={() => captchaMutation.mutate()}>
              {captchaMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
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

        <AdminFormField
          id="captchaProvider"
          label={t('admin.settings.captchaProvider')}
          description={t('admin.settings.captchaProviderHint')}
        >
          <Select
            value={selectedCaptchaProvider}
            onValueChange={(provider: CaptchaProvider) =>
              form.setValue('captchaProvider', provider, { shouldDirty: true })
            }
          >
            <SelectTrigger id="captchaProvider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloudflare-turnstile">{t('admin.settings.captchaProviderTurnstile')}</SelectItem>
              <SelectItem value="google-recaptcha">{t('admin.settings.captchaProviderRecaptcha')}</SelectItem>
              <SelectItem value="hcaptcha">{t('admin.settings.captchaProviderHcaptcha')}</SelectItem>
              <SelectItem value="captchafox">{t('admin.settings.captchaProviderCaptchafox')}</SelectItem>
            </SelectContent>
          </Select>
        </AdminFormField>

        <div className="grid gap-4 md:grid-cols-2">
          <AdminFormField
            id="captchaSiteKey"
            label={t('admin.settings.captchaSiteKey')}
            description={t('admin.settings.captchaSiteKeyHint')}
          >
            <Input placeholder={t('admin.settings.captchaSiteKeyPlaceholder')} {...form.register('captchaSiteKey')} />
          </AdminFormField>
          <AdminFormField
            id="captchaSecretKey"
            label={t('admin.settings.captchaSecretKey')}
            description={t('admin.settings.captchaSecretKeyHint')}
          >
            <Input
              type="password"
              placeholder={t('admin.settings.captchaSecretKeyPlaceholder')}
              {...form.register('captchaSecretKey')}
            />
          </AdminFormField>
        </div>

        {selectedCaptchaProvider === 'google-recaptcha' && (
          <AdminFormField
            id="captchaMinScore"
            label={t('admin.settings.captchaMinScore')}
            description={t('admin.settings.captchaMinScoreHint')}
          >
            <Input
              inputMode="decimal"
              placeholder={t('admin.settings.captchaMinScorePlaceholder')}
              {...form.register('captchaMinScore')}
            />
          </AdminFormField>
        )}
      </AdminFormDrawer>

      <AdminFormDrawer
        open={settingsDrawer === 'storage'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.storageSection')}
        description={t('admin.settings.quotaDescription')}
        bodyClassName="grid gap-5"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={storageMutation.isPending} onClick={() => storageMutation.mutate()}>
              {storageMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <AdminFormField
          id="quotaValue"
          label={t('admin.settings.defaultOrgQuota')}
          description={t('admin.settings.defaultOrgQuotaHint')}
          error={form.formState.errors.quotaValue?.message}
        >
          {(controlProps) => (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                className="flex-1"
                {...controlProps}
                {...form.register('quotaValue', { valueAsNumber: true })}
              />
              <Select value={quotaUnit} onValueChange={(unit) => form.setValue('quotaUnit', unit as StorageQuotaUnit)}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </AdminFormField>

        <AdminFormField
          id="teamQuotaValue"
          label={t('admin.settings.defaultTeamQuota')}
          description={t('admin.settings.defaultTeamQuotaHint')}
          error={form.formState.errors.teamQuotaValue?.message}
        >
          {(controlProps) => (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                className="flex-1"
                {...controlProps}
                {...form.register('teamQuotaValue', { valueAsNumber: true })}
              />
              <Select
                value={teamQuotaUnit}
                onValueChange={(unit) => form.setValue('teamQuotaUnit', unit as StorageQuotaUnit)}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </AdminFormField>
      </AdminFormDrawer>
    </div>
  )
}
