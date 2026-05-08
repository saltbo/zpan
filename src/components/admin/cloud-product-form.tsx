import type { CloudProductInput } from '@shared/schemas'
import type { CloudProduct } from '@shared/types'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const units = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof units

export const emptyPackageForm = {
  name: '',
  description: '',
  storageSize: '',
  storageUnit: 'GB' as Unit,
  trafficSize: '',
  trafficUnit: 'GB' as Unit,
  usdAmount: '9.99',
  cnyAmount: '',
  sortOrder: '0',
}

export type PackageFormState = typeof emptyPackageForm

export function packageInputFromForm(form: PackageFormState): CloudProductInput {
  return {
    type: 'zpan_quota',
    name: form.name,
    description: form.description,
    metadata: {
      storageBytes: form.storageSize ? Math.round(Number(form.storageSize) * units[form.storageUnit]) : 0,
      trafficBytes: form.trafficSize ? Math.round(Number(form.trafficSize) * units[form.trafficUnit]) : 0,
    },
    prices: packagePricesFromForm(form),
    active: true,
    sortOrder: Math.round(Number(form.sortOrder)),
  }
}

export function packageFormFromPackage(pkg: CloudProduct): PackageFormState {
  const storageDisplay = pkg.metadata.storageBytes > 0 ? bytesToDisplay(pkg.metadata.storageBytes) : null
  const trafficDisplay = pkg.metadata.trafficBytes > 0 ? bytesToDisplay(pkg.metadata.trafficBytes) : null
  return {
    name: pkg.name,
    description: pkg.description ?? '',
    storageSize: storageDisplay ? String(storageDisplay.size) : '',
    storageUnit: storageDisplay?.unit ?? 'GB',
    trafficSize: trafficDisplay ? String(trafficDisplay.size) : '',
    trafficUnit: trafficDisplay?.unit ?? 'GB',
    usdAmount: formatMinorAmount(pkg.prices.find((price) => price.currency === 'usd')?.amount),
    cnyAmount: formatMinorAmount(pkg.prices.find((price) => price.currency === 'cny')?.amount),
    sortOrder: String(pkg.sortOrder),
  }
}

export function StoragePlanForm({
  editing,
  form,
  available,
  pending,
  onFormChange,
  onCancel,
  onSubmit,
}: {
  editing: CloudProduct | null
  form: PackageFormState
  available: boolean
  pending: boolean
  onFormChange: (form: PackageFormState) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()

  const storageBytes = form.storageSize ? Math.round(Number(form.storageSize) * units[form.storageUnit]) : 0
  const trafficBytes = form.trafficSize ? Math.round(Number(form.trafficSize) * units[form.trafficUnit]) : 0
  const quotaValid = storageBytes > 0 || trafficBytes > 0

  return (
    <div className="space-y-4">
      <PackageIdentityFields form={form} onFormChange={onFormChange} />
      <PackageQuotaFields
        label={t('admin.cloudStore.storageQuota')}
        sizeId="packageStorageSize"
        sizeValue={form.storageSize}
        unit={form.storageUnit}
        onSizeChange={(storageSize) => onFormChange({ ...form, storageSize })}
        onUnitChange={(storageUnit) => onFormChange({ ...form, storageUnit })}
      />
      <PackageQuotaFields
        label={t('admin.cloudStore.trafficQuota')}
        sizeId="packageTrafficSize"
        sizeValue={form.trafficSize}
        unit={form.trafficUnit}
        onSizeChange={(trafficSize) => onFormChange({ ...form, trafficSize })}
        onUnitChange={(trafficUnit) => onFormChange({ ...form, trafficUnit })}
      />
      {!quotaValid && (form.storageSize !== '' || form.trafficSize !== '') && (
        <p className="text-xs text-destructive">{t('admin.cloudStore.quotaRequired')}</p>
      )}
      <PackageAmountFields form={form} onFormChange={onFormChange} />
      <PackageFormActions
        editing={editing}
        available={available && quotaValid}
        pending={pending}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
}

function packagePricesFromForm(form: PackageFormState) {
  return [
    { currency: 'usd' as const, amount: convertCurrencyAmount(form.usdAmount) },
    { currency: 'cny' as const, amount: convertCurrencyAmount(form.cnyAmount) },
  ].filter((price) => Number.isFinite(price.amount) && price.amount > 0)
}

function convertCurrencyAmount(amount: string): number {
  return Math.round(Number(amount) * 100)
}

function formatMinorAmount(minorAmount: number | undefined): string {
  return minorAmount === undefined ? '' : (minorAmount / 100).toString()
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function PackageIdentityFields({
  form,
  onFormChange,
}: {
  form: PackageFormState
  onFormChange: (form: PackageFormState) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Field label={t('admin.cloudStore.packageName')} htmlFor="packageName">
        <Input id="packageName" value={form.name} onChange={(e) => onFormChange({ ...form, name: e.target.value })} />
      </Field>
      <Field label={t('admin.cloudStore.description')} htmlFor="packageDescription">
        <Textarea
          id="packageDescription"
          value={form.description}
          onChange={(e) => onFormChange({ ...form, description: e.target.value })}
          rows={3}
        />
      </Field>
    </>
  )
}

function PackageQuotaFields({
  label,
  sizeId,
  sizeValue,
  unit,
  onSizeChange,
  onUnitChange,
}: {
  label: string
  sizeId: string
  sizeValue: string
  unit: Unit
  onSizeChange: (value: string) => void
  onUnitChange: (unit: Unit) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_96px] gap-2">
      <Field label={label} htmlFor={sizeId}>
        <Input
          id={sizeId}
          type="number"
          min="1"
          placeholder={t('admin.cloudStore.quotaOptionalHint')}
          value={sizeValue}
          onChange={(e) => onSizeChange(e.target.value)}
        />
      </Field>
      <Field label={t('admin.cloudStore.unit')}>
        <UnitSelect value={unit} onChange={onUnitChange} ariaLabel={`${label} unit`} />
      </Field>
    </div>
  )
}

function PackageAmountFields({
  form,
  onFormChange,
}: {
  form: PackageFormState
  onFormChange: (form: PackageFormState) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumberField
        label={t('admin.cloudStore.usdAmount')}
        id="packageUsdAmount"
        min="0.01"
        step="0.01"
        value={form.usdAmount}
        onChange={(usdAmount) => onFormChange({ ...form, usdAmount })}
      />
      <NumberField
        label={t('admin.cloudStore.cnyAmount')}
        id="packageCnyAmount"
        min="0.01"
        step="0.01"
        value={form.cnyAmount}
        onChange={(cnyAmount) => onFormChange({ ...form, cnyAmount })}
      />
    </div>
  )
}

function NumberField({
  label,
  id,
  min,
  step,
  value,
  onChange,
}: {
  label: string
  id: string
  min?: string
  step?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" min={min} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function UnitSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: Unit
  onChange: (unit: Unit) => void
  ariaLabel?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel ?? value}>
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
  )
}

function PackageFormActions({
  editing,
  available,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: CloudProduct | null
  available: boolean
  pending: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  return (
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
  )
}

function bytesToDisplay(bytes: number): { size: number; unit: Unit } {
  if (bytes >= units.TB && bytes % units.TB === 0) return { size: bytes / units.TB, unit: 'TB' }
  if (bytes >= units.GB && bytes % units.GB === 0) return { size: bytes / units.GB, unit: 'GB' }
  return { size: bytes / units.MB, unit: 'MB' }
}
