import type { QuotaStoreSettings } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export const emptySettingsForm = {
  enabled: false,
}

export type SettingsFormState = typeof emptySettingsForm

export function settingsInput(form: SettingsFormState) {
  return {
    enabled: form.enabled,
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
  const status = settings?.status ?? 'store_disabled'

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{t('admin.quotaStore.settingsTitle')}</CardTitle>
        <CardDescription>{t('admin.quotaStore.settingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label>{t('admin.quotaStore.storeStatus')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status === 'ready' ? 'default' : 'secondary'}>
              {t(`admin.quotaStore.status.${status}`)}
            </Badge>
            <span className="text-sm text-muted-foreground">{t(`admin.quotaStore.statusCopy.${status}`)}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <Label htmlFor="quotaStoreEnabled" className="text-sm">
            {t('admin.quotaStore.enabled')}
          </Label>
          <Switch
            id="quotaStoreEnabled"
            checked={form.enabled}
            disabled={!available || pending}
            onCheckedChange={(enabled) => onFormChange({ ...form, enabled })}
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
