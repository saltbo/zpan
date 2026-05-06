import type { QuotaStorePackageInput } from '@shared/schemas'
import type { QuotaStorePackage } from '@shared/types'
import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
  resourceType: 'storage' as 'storage' | 'traffic',
  size: '100',
  unit: 'GB' as Unit,
  usdAmount: '999',
  cnyAmount: '',
  active: true,
  sortOrder: '0',
}

export type PackageFormState = typeof emptyPackageForm

export function packageInputFromForm(form: PackageFormState): QuotaStorePackageInput {
  return {
    name: form.name,
    description: form.description,
    resourceType: form.resourceType,
    resourceBytes: Math.round(Number(form.size) * units[form.unit]),
    prices: packagePricesFromForm(form),
    active: form.active,
    sortOrder: Math.round(Number(form.sortOrder)),
  }
}

export function packageFormFromPackage(pkg: QuotaStorePackage): PackageFormState {
  const display = bytesToDisplay(pkg.resourceBytes)
  return {
    name: pkg.name,
    description: pkg.description,
    resourceType: pkg.resourceType,
    size: String(display.size),
    unit: display.unit,
    usdAmount: String(pkg.prices.find((price) => price.currency === 'usd')?.amount ?? ''),
    cnyAmount: String(pkg.prices.find((price) => price.currency === 'cny')?.amount ?? ''),
    active: pkg.active,
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
    <div className="space-y-4">
      <PackageIdentityFields form={form} onFormChange={onFormChange} />
      <PackageResourceTypeField form={form} onFormChange={onFormChange} />
      <PackageSizeFields form={form} onFormChange={onFormChange} />
      <PackageAmountFields form={form} onFormChange={onFormChange} />
      <NumberField
        label={t('admin.storagePlans.sortOrder')}
        id="packageSortOrder"
        value={form.sortOrder}
        onChange={(sortOrder) => onFormChange({ ...form, sortOrder })}
      />
      <PackageActiveSwitch active={form.active} onChange={(active) => onFormChange({ ...form, active })} />
      <PackageFormActions
        editing={editing}
        available={available}
        pending={pending}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
}

function packagePricesFromForm(form: PackageFormState) {
  return [
    { currency: 'usd' as const, amount: Math.round(Number(form.usdAmount)) },
    { currency: 'cny' as const, amount: Math.round(Number(form.cnyAmount)) },
  ].filter((price) => Number.isFinite(price.amount) && price.amount > 0)
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
      <Field label={t('admin.storagePlans.packageName')} htmlFor="packageName">
        <Input id="packageName" value={form.name} onChange={(e) => onFormChange({ ...form, name: e.target.value })} />
      </Field>
      <Field label={t('admin.storagePlans.description')} htmlFor="packageDescription">
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

function PackageSizeFields({
  form,
  onFormChange,
}: {
  form: PackageFormState
  onFormChange: (form: PackageFormState) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-[1fr_96px] gap-2">
      <NumberField
        label={t('admin.storagePlans.size')}
        id="packageSize"
        min="1"
        value={form.size}
        onChange={(size) => onFormChange({ ...form, size })}
      />
      <Field label={t('admin.storagePlans.unit')}>
        <UnitSelect value={form.unit} onChange={(unit) => onFormChange({ ...form, unit })} />
      </Field>
    </div>
  )
}

function PackageResourceTypeField({
  form,
  onFormChange,
}: {
  form: PackageFormState
  onFormChange: (form: PackageFormState) => void
}) {
  const { t } = useTranslation()
  return (
    <Field label={t('admin.storagePlans.resourceType')}>
      <Select
        value={form.resourceType}
        onValueChange={(resourceType: 'storage' | 'traffic') => onFormChange({ ...form, resourceType })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="storage">{t('admin.storagePlans.resourceStorage')}</SelectItem>
          <SelectItem value="traffic">{t('admin.storagePlans.resourceTraffic')}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
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
        label={t('admin.storagePlans.usdAmount')}
        id="packageUsdAmount"
        min="1"
        value={form.usdAmount}
        onChange={(usdAmount) => onFormChange({ ...form, usdAmount })}
      />
      <NumberField
        label={t('admin.storagePlans.cnyAmount')}
        id="packageCnyAmount"
        min="1"
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
  value,
  onChange,
}: {
  label: string
  id: string
  min?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" min={min} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function UnitSelect({ value, onChange }: { value: Unit; onChange: (unit: Unit) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
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
  )
}

function PackageActiveSwitch({ active, onChange }: { active: boolean; onChange: (active: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2">
      <Label htmlFor="packageActive">{t('admin.storagePlans.active')}</Label>
      <Switch id="packageActive" checked={active} onCheckedChange={onChange} />
    </div>
  )
}

function PackageFormActions({
  editing,
  available,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: QuotaStorePackage | null
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
