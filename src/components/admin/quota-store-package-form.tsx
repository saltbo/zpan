import type { QuotaStorePackageInput } from '@shared/schemas'
import type { QuotaStorePackage } from '@shared/types'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const units = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof units

export const emptyPackageForm = {
  name: '',
  description: '',
  size: '100',
  unit: 'GB' as Unit,
  amount: '999',
  currency: 'usd' as 'usd' | 'cny',
  active: true,
  sortOrder: '0',
}

export type PackageFormState = typeof emptyPackageForm

export function packageInputFromForm(form: PackageFormState): QuotaStorePackageInput {
  return {
    name: form.name,
    description: form.description,
    bytes: Math.round(Number(form.size) * units[form.unit]),
    amount: Math.round(Number(form.amount)),
    currency: form.currency,
    active: form.active,
    sortOrder: Math.round(Number(form.sortOrder)),
  }
}

export function packageFormFromPackage(pkg: QuotaStorePackage): PackageFormState {
  const display = bytesToDisplay(pkg.bytes)
  return {
    name: pkg.name,
    description: pkg.description,
    size: String(display.size),
    unit: display.unit,
    amount: String(pkg.amount),
    currency: pkg.currency === 'cny' ? 'cny' : 'usd',
    active: pkg.active,
    sortOrder: String(pkg.sortOrder),
  }
}

export function QuotaStorePackageForm({
  editing,
  form,
  available,
  pending,
  onFormChange,
  onCancel,
  onSubmit,
}: {
  editing: QuotaStorePackage | null
  form: PackageFormState
  available: boolean
  pending: boolean
  onFormChange: (form: PackageFormState) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle>{editing ? t('admin.quotaStore.editPackage') : t('admin.quotaStore.newPackage')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t('admin.quotaStore.packageName')} htmlFor="packageName">
          <Input id="packageName" value={form.name} onChange={(e) => onFormChange({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('admin.quotaStore.description')} htmlFor="packageDescription">
          <Textarea
            id="packageDescription"
            value={form.description}
            onChange={(e) => onFormChange({ ...form, description: e.target.value })}
            rows={3}
          />
        </Field>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label={t('admin.quotaStore.size')} htmlFor="packageSize">
            <Input
              id="packageSize"
              type="number"
              min="1"
              value={form.size}
              onChange={(e) => onFormChange({ ...form, size: e.target.value })}
            />
          </Field>
          <Field label={t('admin.quotaStore.unit')}>
            <Select value={form.unit} onValueChange={(unit: Unit) => onFormChange({ ...form, unit })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(units).map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field label={t('admin.quotaStore.amount')} htmlFor="packageAmount">
            <Input
              id="packageAmount"
              type="number"
              min="1"
              value={form.amount}
              onChange={(e) => onFormChange({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label={t('admin.quotaStore.currency')}>
            <Select
              value={form.currency}
              onValueChange={(currency: 'usd' | 'cny') => onFormChange({ ...form, currency })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usd">USD</SelectItem>
                <SelectItem value="cny">CNY</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t('admin.quotaStore.sortOrder')} htmlFor="packageSortOrder">
          <Input
            id="packageSortOrder"
            type="number"
            value={form.sortOrder}
            onChange={(e) => onFormChange({ ...form, sortOrder: e.target.value })}
          />
        </Field>
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label htmlFor="packageActive">{t('admin.quotaStore.active')}</Label>
          <Switch
            id="packageActive"
            checked={form.active}
            onCheckedChange={(active) => onFormChange({ ...form, active })}
          />
        </div>
        <div className="flex justify-end gap-2">
          {editing && (
            <Button variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          <Button disabled={!available || pending} onClick={onSubmit}>
            <Plus className="mr-2 h-4 w-4" />
            {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function bytesToDisplay(bytes: number): { size: number; unit: Unit } {
  if (bytes >= units.TB && bytes % units.TB === 0) return { size: bytes / units.TB, unit: 'TB' }
  if (bytes >= units.GB && bytes % units.GB === 0) return { size: bytes / units.GB, unit: 'GB' }
  return { size: bytes / units.MB, unit: 'MB' }
}
