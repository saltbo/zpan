import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AdminFormDrawer, AdminFormField } from '@/components/admin/admin-form-drawer'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { type EmailConfigData, getEmailConfig, saveEmailConfig, testEmail } from '@/lib/api'

const emailConfigQueryKey = ['admin', 'email-config'] as const

type ProviderType = 'smtp' | 'http' | 'cloudflare'
type EmailConfigResponse = Awaited<ReturnType<typeof getEmailConfig>>

interface FormState {
  enabled: boolean
  provider: ProviderType
  from: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  smtpSecure: boolean
  httpUrl: string
  httpApiKey: string
}

const emptyForm: FormState = {
  enabled: false,
  provider: 'smtp',
  from: '',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: true,
  httpUrl: '',
  httpApiKey: '',
}

function formToPayload(form: FormState): EmailConfigData {
  if (form.provider === 'smtp') {
    return {
      provider: 'smtp',
      enabled: form.enabled,
      from: form.from,
      smtp: {
        host: form.smtpHost,
        port: form.smtpPort,
        user: form.smtpUser,
        pass: form.smtpPass,
        secure: form.smtpSecure,
      },
    }
  }
  if (form.provider === 'cloudflare') {
    return {
      provider: 'cloudflare',
      enabled: form.enabled,
      from: form.from,
    }
  }
  return {
    provider: 'http',
    enabled: form.enabled,
    from: form.from,
    http: { url: form.httpUrl, apiKey: form.httpApiKey },
  }
}

function formStateFromConfig(data: EmailConfigResponse | undefined): FormState {
  if (!data) return emptyForm
  if (data.provider === null) return { ...emptyForm, enabled: data.enabled }

  const config = data as EmailConfigData
  if (config.provider === 'smtp') {
    return {
      enabled: config.enabled,
      provider: 'smtp',
      from: config.from,
      smtpHost: config.smtp.host,
      smtpPort: config.smtp.port,
      smtpUser: config.smtp.user,
      smtpPass: config.smtp.pass,
      smtpSecure: config.smtp.secure,
      httpUrl: '',
      httpApiKey: '',
    }
  }

  if (config.provider === 'http') {
    return {
      enabled: config.enabled,
      provider: 'http',
      from: config.from,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
      smtpSecure: true,
      httpUrl: config.http.url,
      httpApiKey: config.http.apiKey,
    }
  }

  return {
    enabled: config.enabled,
    provider: 'cloudflare',
    from: config.from,
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpSecure: true,
    httpUrl: '',
    httpApiKey: '',
  }
}

export function EmailConfigSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [configOpen, setConfigOpen] = useState(false)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testEmailAddr, setTestEmailAddr] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: emailConfigQueryKey,
    queryFn: getEmailConfig,
  })

  useEffect(() => {
    setForm(formStateFromConfig(data))
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () => saveEmailConfig(formToPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailConfigQueryKey })
      setConfigOpen(false)
      toast.success(t('admin.auth.emailSaved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const testMutation = useMutation({
    mutationFn: testEmail,
    onSuccess: () => {
      toast.success(t('admin.auth.testEmailSent'))
      setTestDialogOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }))
  const savedForm = formStateFromConfig(data)

  function closeConfigDrawer() {
    setConfigOpen(false)
    setForm(savedForm)
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.emailSection')}</h3>
          <p className="text-sm">
            {savedForm.enabled ? t('admin.auth.emailEnabled') : t('common.disabled')} ·{' '}
            {savedForm.provider === 'cloudflare'
              ? t('admin.auth.emailCloudflare')
              : savedForm.provider === 'smtp'
                ? t('admin.auth.emailSmtp')
                : t('admin.auth.emailHttp')}
          </p>
          <p className="text-xs text-muted-foreground">{savedForm.from || t('admin.auth.emailNotConfigured')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setTestDialogOpen(true)} disabled={!savedForm.enabled}>
            {t('admin.auth.testEmail')}
          </Button>
          <Button size="sm" onClick={() => setConfigOpen(true)}>
            {t('common.edit')}
          </Button>
        </div>
      </div>

      <AdminFormDrawer
        open={configOpen}
        onOpenChange={(open) => {
          if (open) setConfigOpen(true)
          else closeConfigDrawer()
        }}
        title={t('admin.auth.emailSection')}
        description={t('admin.auth.emailEnabledHint')}
        bodyClassName="grid gap-4"
        formProps={{
          onSubmit: (event) => {
            event.preventDefault()
            saveMutation.mutate()
          },
        }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeConfigDrawer} disabled={saveMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="emailEnabled">{t('admin.auth.emailEnabled')}</Label>
            <p className="text-sm text-muted-foreground">{t('admin.auth.emailEnabledHint')}</p>
          </div>
          <Switch id="emailEnabled" checked={form.enabled} onCheckedChange={(v) => update({ enabled: !!v })} />
        </div>

        <AdminFormField id="email-provider" label={t('admin.auth.emailProvider')}>
          <Select value={form.provider} onValueChange={(v) => update({ provider: v as ProviderType })}>
            <SelectTrigger id="email-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cloudflare">{t('admin.auth.emailCloudflare')}</SelectItem>
              <SelectItem value="smtp">{t('admin.auth.emailSmtp')}</SelectItem>
              <SelectItem value="http">{t('admin.auth.emailHttp')}</SelectItem>
            </SelectContent>
          </Select>
        </AdminFormField>

        <AdminFormField id="email-from" label={t('admin.auth.emailFrom')}>
          <Input type="email" value={form.from} onChange={(e) => update({ from: e.target.value })} />
        </AdminFormField>

        {form.provider === 'smtp' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <AdminFormField id="smtp-host" label={t('admin.auth.smtpHost')}>
                <Input value={form.smtpHost} onChange={(e) => update({ smtpHost: e.target.value })} />
              </AdminFormField>
              <AdminFormField id="smtp-port" label={t('admin.auth.smtpPort')}>
                <Input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => update({ smtpPort: Number(e.target.value) })}
                />
              </AdminFormField>
            </div>
            <AdminFormField id="smtp-user" label={t('admin.auth.smtpUser')}>
              <Input value={form.smtpUser} onChange={(e) => update({ smtpUser: e.target.value })} />
            </AdminFormField>
            <AdminFormField id="smtp-pass" label={t('admin.auth.smtpPass')}>
              <Input type="password" value={form.smtpPass} onChange={(e) => update({ smtpPass: e.target.value })} />
            </AdminFormField>
            <div className="flex items-center gap-2">
              <Checkbox
                id="smtpSecure"
                checked={form.smtpSecure}
                onCheckedChange={(v) => update({ smtpSecure: !!v })}
              />
              <Label htmlFor="smtpSecure">{t('admin.auth.smtpSecure')}</Label>
            </div>
          </>
        ) : form.provider === 'http' ? (
          <>
            <AdminFormField id="email-http-url" label={t('admin.auth.httpUrl')}>
              <Input value={form.httpUrl} onChange={(e) => update({ httpUrl: e.target.value })} />
            </AdminFormField>
            <AdminFormField id="email-http-api-key" label={t('admin.auth.httpApiKey')}>
              <Input type="password" value={form.httpApiKey} onChange={(e) => update({ httpApiKey: e.target.value })} />
            </AdminFormField>
          </>
        ) : null}
      </AdminFormDrawer>

      <AdminFormDrawer
        open={testDialogOpen}
        onOpenChange={setTestDialogOpen}
        title={t('admin.auth.testEmail')}
        description={t('admin.auth.testEmailTo')}
        formProps={{
          onSubmit: (event) => {
            event.preventDefault()
            testMutation.mutate(testEmailAddr)
          },
        }}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setTestDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={testMutation.isPending || !testEmailAddr}>
              {testMutation.isPending ? t('common.loading') : t('admin.auth.testEmail')}
            </Button>
          </>
        }
      >
        <AdminFormField id="test-email-address" label={t('admin.auth.testEmailTo')}>
          <Input
            type="email"
            value={testEmailAddr}
            onChange={(e) => setTestEmailAddr(e.target.value)}
            placeholder="test@example.com"
          />
        </AdminFormField>
      </AdminFormDrawer>
    </div>
  )
}
