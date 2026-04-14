import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type EmailConfigData, getEmailConfig, saveEmailConfig, testEmail } from '@/lib/api'

const emailConfigQueryKey = ['admin', 'email-config'] as const

type ProviderType = 'smtp' | 'http'

interface FormState {
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
  return {
    provider: 'http',
    from: form.from,
    http: { url: form.httpUrl, apiKey: form.httpApiKey },
  }
}

export function EmailConfigSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [testDialogOpen, setTestDialogOpen] = useState(false)
  const [testEmailAddr, setTestEmailAddr] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: emailConfigQueryKey,
    queryFn: getEmailConfig,
  })

  useEffect(() => {
    if (!data || data.provider === null) return
    const config = data as EmailConfigData
    if (config.provider === 'smtp') {
      setForm({
        provider: 'smtp',
        from: config.from,
        smtpHost: config.smtp.host,
        smtpPort: config.smtp.port,
        smtpUser: config.smtp.user,
        smtpPass: config.smtp.pass,
        smtpSecure: config.smtp.secure,
        httpUrl: '',
        httpApiKey: '',
      })
    } else {
      setForm({
        provider: 'http',
        from: config.from,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
        smtpSecure: true,
        httpUrl: config.http.url,
        httpApiKey: config.http.apiKey,
      })
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: () => saveEmailConfig(formToPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: emailConfigQueryKey })
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

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-medium text-muted-foreground">{t('admin.auth.emailSection')}</h3>

      <div className="max-w-lg space-y-4">
        <div className="space-y-1.5">
          <Label>{t('admin.auth.emailProvider')}</Label>
          <Select value={form.provider} onValueChange={(v) => update({ provider: v as ProviderType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="smtp">{t('admin.auth.emailSmtp')}</SelectItem>
              <SelectItem value="http">{t('admin.auth.emailHttp')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t('admin.auth.emailFrom')}</Label>
          <Input type="email" value={form.from} onChange={(e) => update({ from: e.target.value })} />
        </div>

        {form.provider === 'smtp' ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>{t('admin.auth.smtpHost')}</Label>
                <Input value={form.smtpHost} onChange={(e) => update({ smtpHost: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('admin.auth.smtpPort')}</Label>
                <Input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => update({ smtpPort: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.smtpUser')}</Label>
              <Input value={form.smtpUser} onChange={(e) => update({ smtpUser: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.smtpPass')}</Label>
              <Input type="password" value={form.smtpPass} onChange={(e) => update({ smtpPass: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="smtpSecure"
                checked={form.smtpSecure}
                onCheckedChange={(v) => update({ smtpSecure: !!v })}
              />
              <Label htmlFor="smtpSecure">{t('admin.auth.smtpSecure')}</Label>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.httpUrl')}</Label>
              <Input value={form.httpUrl} onChange={(e) => update({ httpUrl: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.auth.httpApiKey')}</Label>
              <Input type="password" value={form.httpApiKey} onChange={(e) => update({ httpApiKey: e.target.value })} />
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="outline" onClick={() => setTestDialogOpen(true)}>
            {t('admin.auth.testEmail')}
          </Button>
        </div>
      </div>

      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.auth.testEmail')}</DialogTitle>
            <DialogDescription>{t('admin.auth.testEmailTo')}</DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            value={testEmailAddr}
            onChange={(e) => setTestEmailAddr(e.target.value)}
            placeholder="test@example.com"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => testMutation.mutate(testEmailAddr)}
              disabled={testMutation.isPending || !testEmailAddr}
            >
              {testMutation.isPending ? t('common.loading') : t('admin.auth.testEmail')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
