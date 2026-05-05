import type { QuotaStoreSettings } from '@shared/types'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const emptySettingsForm = {
  enabled: false,
  cloudBaseUrl: '',
  publicInstanceUrl: '',
  webhookSigningSecret: '',
}

export type SettingsFormState = typeof emptySettingsForm

export function settingsInput(form: SettingsFormState) {
  return {
    enabled: form.enabled,
    cloudBaseUrl: form.cloudBaseUrl,
    publicInstanceUrl: form.publicInstanceUrl,
    ...(form.webhookSigningSecret ? { webhookSigningSecret: form.webhookSigningSecret } : {}),
  }
}

export function QuotaStoreSettingsPanel({
  available,
  settings,
  form,
  pending,
  onFormChange,
  onSave,
}: {
  available: boolean
  settings: QuotaStoreSettings | null
  form: SettingsFormState
  pending: boolean
  onFormChange: (form: SettingsFormState) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const callbackUrl = form.publicInstanceUrl
    ? `${form.publicInstanceUrl.replace(/\/+$/, '')}/api/quota-store/webhooks/cloud`
    : ''

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('admin.quotaStore.cloudTitle')}</CardTitle>
        <CardDescription>{t('admin.quotaStore.cloudDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_180px]">
        <div className="space-y-2">
          <Label>{t('admin.quotaStore.cloudBaseUrl')}</Label>
          <Input
            value={form.cloudBaseUrl}
            onChange={(e) => onFormChange({ ...form, cloudBaseUrl: e.target.value })}
            disabled={!available}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>{t('admin.quotaStore.publicInstanceUrl')}</Label>
          <Input
            value={form.publicInstanceUrl}
            onChange={(e) => onFormChange({ ...form, publicInstanceUrl: e.target.value })}
            disabled={!available}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>{t('admin.quotaStore.callbackUrl')}</Label>
          <div className="flex gap-2">
            <Input value={callbackUrl} readOnly />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!callbackUrl}
              onClick={() => navigator.clipboard.writeText(callbackUrl)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('admin.quotaStore.signing')}</Label>
          <Badge variant={settings?.webhookSigningSecretSet ? 'default' : 'secondary'}>
            {settings?.webhookSigningSecretSet ? t('common.configured') : t('common.notConfigured')}
          </Badge>
        </div>
        <div className="space-y-2">
          <Label>{t('admin.quotaStore.webhookSecret')}</Label>
          <Input
            type="password"
            value={form.webhookSigningSecret}
            onChange={(e) => onFormChange({ ...form, webhookSigningSecret: e.target.value })}
            disabled={!available}
          />
        </div>
        <div className="flex justify-end md:col-span-2">
          <Button disabled={!available || pending} onClick={onSave}>
            {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
