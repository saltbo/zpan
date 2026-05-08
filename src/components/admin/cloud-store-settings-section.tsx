import { HardDrive } from 'lucide-react'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export type StorageQuotaUnit = 'MB' | 'GB'

export function StorageSettingsSection({
  hasCloudStore,
  quotaUnit,
  cloudStoreEnabled,
  quotaError,
  quotaInputProps,
  pending,
  cloudStoreLoading,
  onQuotaUnitChange,
  onSave,
  onCloudStoreChange,
}: {
  hasCloudStore: boolean
  quotaUnit: StorageQuotaUnit
  cloudStoreEnabled: boolean
  quotaError?: string
  quotaInputProps: UseFormRegisterReturn
  pending: boolean
  cloudStoreLoading: boolean
  onQuotaUnitChange: (unit: StorageQuotaUnit) => void
  onSave: () => void
  onCloudStoreChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-border/60 bg-emerald-500/10 p-2 text-emerald-600">
            <HardDrive className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <CardTitle>{t('admin.settings.storageSection')}</CardTitle>
            <CardDescription>{t('admin.settings.quotaDescription')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="quotaValue">{t('admin.settings.defaultOrgQuota')}</Label>
          <div className="flex items-center gap-2">
            <Input id="quotaValue" type="number" min={1} step={1} className="flex-1" {...quotaInputProps} />
            <Select value={quotaUnit} onValueChange={onQuotaUnitChange}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MB">MB</SelectItem>
                <SelectItem value="GB">GB</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t('admin.settings.defaultOrgQuotaHint')}</p>
          {quotaError && <p className="text-xs text-destructive">{quotaError}</p>}
        </div>

        <div
          className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
            !hasCloudStore ? 'opacity-60' : ''
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="cloudStoreEnabled">{t('admin.settings.cloudStoreEnabled')}</Label>
              <ProBadge tooltip={t('admin.settings.storageProTooltip')} />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t('admin.settings.cloudStoreEnabledHint')}</p>
          </div>
          <Switch
            id="cloudStoreEnabled"
            checked={cloudStoreEnabled}
            disabled={!hasCloudStore || pending || cloudStoreLoading}
            onCheckedChange={onCloudStoreChange}
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" disabled={pending} onClick={onSave}>
            {pending ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
