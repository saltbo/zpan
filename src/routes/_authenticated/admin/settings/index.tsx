import { zodResolver } from '@hookform/resolvers/zod'
import { CAPTCHA_PROVIDERS, type CaptchaProvider } from '@shared/captcha'
import {
  DEFAULT_ORG_QUOTA,
  DEFAULT_ORG_TRAFFIC_QUOTA,
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  SignupMode,
} from '@shared/constants'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Database, Globe2, ShieldCheck, UserPlus } from 'lucide-react'
import { type ComponentProps, type ReactNode, useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { AdminFormDrawer, AdminFormField, AdminFormLabel } from '@/components/admin/admin-form-drawer'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { BrandingSection } from '@/components/admin/branding-section'
import type { StorageQuotaUnit } from '@/components/admin/cloud-store-settings-section'
import { EmailConfigSection } from '@/components/admin/email-config-section'
import { ProBadge } from '@/components/ProBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { siteConfigQueryKey } from '@/hooks/use-site-config'
import { siteSettingsQueryKey, useSiteSettings } from '@/hooks/use-site-settings'
import { useEntitlement } from '@/hooks/useEntitlement'
import { updateSiteCaptcha, updateSiteIdentity, updateSiteQuotas, updateSiteRegistration } from '@/lib/api'

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
    .url('Site URL must be a valid URL')
    .refine((value) => {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === ''
      )
    }, 'Site URL must be an HTTP or HTTPS origin without a path, query, or fragment'),
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
type FieldControlProps = {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

function SettingsStatusBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return <Badge variant={enabled ? 'default' : 'secondary'}>{label}</Badge>
}

function SettingsItemCard({
  icon,
  title,
  description,
  status,
  details,
  proTooltip,
  editLabel,
  onEdit,
}: {
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  status: ReactNode
  details?: ReactNode
  proTooltip?: string
  editLabel: string
  onEdit: () => void
}) {
  return (
    <Card data-settings-row className="rounded-lg border-border/70 py-0 shadow-xs">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
            {icon}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-sm leading-5">{title}</CardTitle>
              {proTooltip && <ProBadge tooltip={proTooltip} />}
            </div>
            <CardDescription className="max-w-2xl leading-5">{description}</CardDescription>
            {details && <div className="text-sm text-muted-foreground">{details}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
          {status}
          <Button size="sm" variant="outline" onClick={onEdit}>
            {editLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SettingsSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-muted-foreground text-xs font-medium uppercase">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  )
}

function CaptchaProviderLabel({ provider }: { provider: CaptchaProvider }) {
  switch (provider) {
    case 'google-recaptcha':
      return 'Google reCAPTCHA'
    case 'hcaptcha':
      return 'hCaptcha'
    case 'captchafox':
      return 'CaptchaFox'
    case 'cloudflare-turnstile':
      return 'Cloudflare Turnstile'
  }
}

export function SettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [settingsDrawer, setSettingsDrawer] = useState<SettingsDrawer>(null)
  const { data: settings, isLoading } = useSiteSettings()
  const siteName = settings?.identity.name ?? DEFAULT_SITE_NAME
  const siteDescription = settings?.identity.description ?? DEFAULT_SITE_DESCRIPTION
  const sitePublicOrigin = settings?.identity.publicUrl ?? ''
  const quotaBytes = settings?.quotas.defaultOrgBytes ?? DEFAULT_ORG_QUOTA
  const teamQuotaBytes = settings?.quotas.defaultTeamBytes ?? quotaBytes
  const monthlyTrafficBytes = settings?.quotas.defaultMonthlyTrafficBytes ?? DEFAULT_ORG_TRAFFIC_QUOTA
  const authSignupMode = settings?.registration.configuredMode ?? SignupMode.OPEN
  const effectiveSignupMode = settings?.registration.effectiveMode ?? authSignupMode
  const captchaEnabled = settings?.captcha.enabled ?? false
  const captchaProvider = settings?.captcha.provider ?? 'cloudflare-turnstile'
  const captchaSiteKey = settings?.captcha.siteKey ?? ''
  const captchaSecretConfigured = settings?.captcha.secretConfigured ?? false
  const captchaMinScore = settings?.captcha.minScore === null ? '' : String(settings?.captcha.minScore ?? '')
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
      captchaSecretKey: '',
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
      await updateSiteIdentity({
        name: values.siteName,
        description: values.siteDescription,
        publicUrl: values.sitePublicOrigin.trim(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
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
      const teamUnit =
        values.teamQuotaUnit === 'MB' || values.teamQuotaUnit === 'GB'
          ? values.teamQuotaUnit
          : bytesToDisplay(teamQuotaBytes).unit
      const teamBytes = Math.round(values.teamQuotaValue * UNITS[teamUnit])
      await updateSiteQuotas({
        defaultOrgBytes: bytes,
        defaultTeamBytes: teamBytes,
        defaultMonthlyTrafficBytes: monthlyTrafficBytes,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
      closeSettingsDrawer({ reset: false })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const registrationMutation = useMutation({
    mutationFn: (checked: boolean) => updateSiteRegistration({ mode: checked ? SignupMode.OPEN : SignupMode.CLOSED }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
      closeSettingsDrawer({ reset: false })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
      toast.error(err.message)
    },
  })

  const captchaMutation = useMutation({
    mutationFn: async () => {
      const valid = await form.trigger(['captchaEnabled', 'captchaSiteKey', 'captchaSecretKey'])
      if (!valid) throw new Error(t('admin.settings.captchaInvalid'))
      const values = form.getValues()
      const secretKey = values.captchaSecretKey.trim()
      const minScore = values.captchaMinScore.trim()
      await updateSiteCaptcha({
        enabled: values.captchaEnabled,
        provider: values.captchaProvider,
        siteKey: values.captchaSiteKey.trim(),
        ...(secretKey ? { secretKey } : {}),
        minScore: minScore ? Number(minScore) : null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
      closeSettingsDrawer({ reset: false })
      toast.success(t('admin.settings.saved'))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: siteSettingsQueryKey })
      queryClient.invalidateQueries({ queryKey: siteConfigQueryKey })
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
  const savedRegistrationsEnabled = effectiveSignupMode === SignupMode.OPEN

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title={t('admin.settings.title')} description={t('admin.settings.subtitle')} />

      <div className="space-y-5">
        <SettingsSection title={t('admin.settings.siteSection')}>
          <SettingsItemCard
            icon={<Globe2 className="size-4" />}
            title={t('admin.settings.identityTitle')}
            description={t('admin.settings.identityDescription')}
            details={
              <span>
                {siteName} · {sitePublicOrigin || t('admin.settings.sitePublicOriginPlaceholder')}
              </span>
            }
            status={
              <SettingsStatusBadge
                enabled={hasWhiteLabel}
                label={hasWhiteLabel ? t('admin.auth.enabled') : t('common.disabled')}
              />
            }
            proTooltip={t('admin.settings.identityProTooltip')}
            editLabel={t('common.edit')}
            onEdit={() => setSettingsDrawer('identity')}
          />

          <BrandingSection />

          <SettingsItemCard
            icon={<UserPlus className="size-4" />}
            title={t('admin.settings.registrationTitle')}
            description={t('admin.settings.registrationDescription')}
            details={
              savedRegistrationsEnabled
                ? t('admin.settings.registrationHintOpen')
                : t('admin.settings.registrationHintClosed')
            }
            status={
              <SettingsStatusBadge
                enabled={savedRegistrationsEnabled}
                label={savedRegistrationsEnabled ? t('admin.auth.enabled') : t('common.disabled')}
              />
            }
            proTooltip={t('admin.settings.registrationUpgradeHint')}
            editLabel={t('common.edit')}
            onEdit={() => setSettingsDrawer('registration')}
          />

          <SettingsItemCard
            icon={<ShieldCheck className="size-4" />}
            title={t('admin.settings.captchaTitle')}
            description={t('admin.settings.captchaDescription')}
            details={captchaEnabled ? <CaptchaProviderLabel provider={captchaProvider} /> : t('common.disabled')}
            status={
              <SettingsStatusBadge
                enabled={captchaEnabled}
                label={captchaEnabled ? t('admin.auth.enabled') : t('common.disabled')}
              />
            }
            editLabel={t('common.edit')}
            onEdit={() => setSettingsDrawer('captcha')}
          />
        </SettingsSection>

        <SettingsSection title={t('admin.settings.storageSection')}>
          <SettingsItemCard
            icon={<Database className="size-4" />}
            title={t('admin.settings.storageSection')}
            description={t('admin.settings.quotaDescription')}
            details={
              <span>
                {t('admin.settings.defaultOrgQuota')}: {savedQuota.value} {savedQuota.unit} ·{' '}
                {t('admin.settings.defaultTeamQuota')}: {savedTeamQuota.value} {savedTeamQuota.unit}
              </span>
            }
            status={
              <Badge variant="secondary">
                {savedQuota.value} {savedQuota.unit}
              </Badge>
            }
            editLabel={t('common.edit')}
            onEdit={() => setSettingsDrawer('storage')}
          />
        </SettingsSection>

        <SettingsSection title={t('admin.auth.emailSection')}>
          <EmailConfigSection />
        </SettingsSection>
      </div>

      <AdminFormDrawer
        open={settingsDrawer === 'identity'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.identityTitle')}
        description={t('admin.settings.identityDescription')}
        bodyClassName="grid auto-rows-min content-start gap-4"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
              {t('common.cancel')}
            </Button>
            <Button type="button" disabled={identityMutation.isPending} onClick={() => identityMutation.mutate()}>
              {identityMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <AdminFormField
          id="siteName"
          label={t('admin.settings.siteName')}
          help={t('admin.settings.siteNameHint')}
          required
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
          help={t('admin.settings.siteDescriptionHint')}
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
          help={t('admin.settings.sitePublicOriginHint')}
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
        bodyClassName="grid auto-rows-min content-start gap-4"
        footer={
          <Button type="button" variant="outline" onClick={() => closeSettingsDrawer()}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="flex items-center justify-between gap-4">
          <AdminFormLabel
            htmlFor="registrationsEnabled"
            help={
              registrationsEnabled
                ? t('admin.settings.registrationHintOpen')
                : t('admin.settings.registrationHintClosed')
            }
          >
            {t('admin.settings.registrationLabel')}
          </AdminFormLabel>
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
        {!hasOpenRegistration && (
          <p className="text-xs text-muted-foreground">{t('admin.settings.registrationUpgradeHint')}</p>
        )}
      </AdminFormDrawer>

      <AdminFormDrawer
        open={settingsDrawer === 'captcha'}
        onOpenChange={(open) => !open && closeSettingsDrawer()}
        title={t('admin.settings.captchaTitle')}
        description={t('admin.settings.captchaDescription')}
        bodyClassName="grid auto-rows-min content-start gap-4"
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
        <div className="flex items-center justify-between gap-4">
          <AdminFormLabel htmlFor="captchaEnabled" help={t('admin.settings.captchaEnabledHint')}>
            {t('admin.settings.captchaEnabled')}
          </AdminFormLabel>
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
          help={t('admin.settings.captchaProviderHint')}
          required
        >
          <Select
            value={selectedCaptchaProvider}
            onValueChange={(provider: CaptchaProvider) =>
              form.setValue('captchaProvider', provider, { shouldDirty: true })
            }
          >
            <SelectTrigger id="captchaProvider">
              <SelectValue placeholder={t('admin.settings.captchaProviderPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloudflare-turnstile">{t('admin.settings.captchaProviderTurnstile')}</SelectItem>
              <SelectItem value="google-recaptcha">{t('admin.settings.captchaProviderRecaptcha')}</SelectItem>
              <SelectItem value="hcaptcha">{t('admin.settings.captchaProviderHcaptcha')}</SelectItem>
              <SelectItem value="captchafox">{t('admin.settings.captchaProviderCaptchafox')}</SelectItem>
            </SelectContent>
          </Select>
        </AdminFormField>

        <AdminFormField
          id="captchaSiteKey"
          label={t('admin.settings.captchaSiteKey')}
          help={t('admin.settings.captchaSiteKeyHint')}
          required={captchaProtectionEnabled}
        >
          <Input placeholder={t('admin.settings.captchaSiteKeyPlaceholder')} {...form.register('captchaSiteKey')} />
        </AdminFormField>
        <AdminFormField
          id="captchaSecretKey"
          label={t('admin.settings.captchaSecretKey')}
          help={t('admin.settings.captchaSecretKeyHint')}
          required={captchaProtectionEnabled}
        >
          <Input
            type="password"
            placeholder={captchaSecretConfigured ? '••••••••' : t('admin.settings.captchaSecretKeyPlaceholder')}
            {...form.register('captchaSecretKey')}
          />
        </AdminFormField>

        {selectedCaptchaProvider === 'google-recaptcha' && (
          <AdminFormField
            id="captchaMinScore"
            label={t('admin.settings.captchaMinScore')}
            help={t('admin.settings.captchaMinScoreHint')}
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
        bodyClassName="grid auto-rows-min content-start gap-4"
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
          help={t('admin.settings.defaultOrgQuotaHint')}
          required
          error={form.formState.errors.quotaValue?.message}
        >
          {(controlProps) => (
            <QuotaAmountInput
              controlProps={controlProps}
              inputProps={form.register('quotaValue', { valueAsNumber: true })}
              placeholder={t('admin.settings.quotaValuePlaceholder')}
              unit={quotaUnit}
              onUnitChange={(unit) => form.setValue('quotaUnit', unit)}
            />
          )}
        </AdminFormField>

        <AdminFormField
          id="teamQuotaValue"
          label={t('admin.settings.defaultTeamQuota')}
          help={t('admin.settings.defaultTeamQuotaHint')}
          required
          error={form.formState.errors.teamQuotaValue?.message}
        >
          {(controlProps) => (
            <QuotaAmountInput
              controlProps={controlProps}
              inputProps={form.register('teamQuotaValue', { valueAsNumber: true })}
              placeholder={t('admin.settings.quotaValuePlaceholder')}
              unit={teamQuotaUnit}
              onUnitChange={(unit) => form.setValue('teamQuotaUnit', unit)}
            />
          )}
        </AdminFormField>
      </AdminFormDrawer>
    </div>
  )
}

function QuotaAmountInput({
  controlProps,
  inputProps,
  placeholder,
  unit,
  onUnitChange,
}: {
  controlProps: FieldControlProps
  inputProps: ComponentProps<typeof Input>
  placeholder: string
  unit: StorageQuotaUnit
  onUnitChange: (unit: StorageQuotaUnit) => void
}) {
  return (
    <div className="flex h-9 w-48 items-center overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
      <Input
        {...inputProps}
        {...controlProps}
        type="number"
        min={1}
        step={1}
        placeholder={placeholder}
        className="h-8 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Select value={unit} onValueChange={(nextUnit) => onUnitChange(nextUnit as StorageQuotaUnit)}>
        <SelectTrigger className="h-8 w-20 rounded-none border-0 border-l bg-transparent px-2 shadow-none focus-visible:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="MB">MB</SelectItem>
          <SelectItem value="GB">GB</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
