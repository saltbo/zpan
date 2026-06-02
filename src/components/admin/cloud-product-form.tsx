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
import { cloudProductIncludedCredits, cloudProductStorageBytes } from '@/lib/cloud-product'

const units = { MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 } as const
type Unit = keyof typeof units

export const emptyPackageForm = {
  name: '',
  description: '',
  storageSize: '',
  storageUnit: 'GB' as Unit,
  includedCredits: '',
  usdMonthlyAmount: '9.99',
  usdYearlyAmount: '',
  sortOrder: '0',
}

export type PackageFormState = typeof emptyPackageForm

export const emptyCreditPackageForm = {
  name: '',
  description: '',
  credits: '1000',
  usdAmount: '9.99',
  sortOrder: '0',
}

export type CreditPackageFormState = typeof emptyCreditPackageForm
type CloudProductPriceInput = CloudProductInput['prices'][number]

export function packageInputFromForm(form: PackageFormState): CloudProductInput {
  const prices = packagePricesFromForm(form)
  return {
    type: 'store_item',
    name: form.name,
    description: form.description,
    metadata: {
      deliverable: {
        type: 'zpan.plan',
        storageBytes: form.storageSize ? Math.round(Number(form.storageSize) * units[form.storageUnit]) : 0,
        includedCredits: creditsFromForm(form),
      },
    },
    prices,
    active: true,
    sortOrder: Math.round(Number(form.sortOrder)),
  }
}

export function packageFormFromPackage(pkg: CloudProduct): PackageFormState {
  const storageBytes = cloudProductStorageBytes(pkg)
  const storageDisplay = storageBytes > 0 ? bytesToDisplay(storageBytes) : null
  return {
    name: pkg.name,
    description: pkg.description ?? '',
    storageSize: storageDisplay ? String(storageDisplay.size) : '',
    storageUnit: storageDisplay?.unit ?? 'GB',
    includedCredits: String(cloudProductIncludedCredits(pkg) || ''),
    usdMonthlyAmount: formatMinorAmount(recurringUsdPrice(pkg, 'month')?.amount),
    usdYearlyAmount: formatMinorAmount(recurringUsdPrice(pkg, 'year')?.amount),
    sortOrder: String(pkg.sortOrder),
  }
}

export function creditPackageInputFromForm(form: CreditPackageFormState): CloudProductInput {
  const credits = creditsFromValue(form.credits)
  const usdPrice: CloudProductPriceInput = {
    currency: 'usd',
    amount: convertCurrencyAmount(form.usdAmount),
    metadata: { creditGrantType: 'top_up', creditAmount: String(credits) },
  }
  return {
    type: 'store_item',
    name: form.name,
    description: form.description,
    metadata: {
      deliverable: {
        type: 'zpan.credits',
        includedCredits: credits,
      },
    },
    prices: [usdPrice].filter((price) => Number.isFinite(price.amount) && price.amount > 0),
    active: true,
    sortOrder: Math.round(Number(form.sortOrder)),
  }
}

export function creditPackageFormFromPackage(pkg: CloudProduct): CreditPackageFormState {
  return {
    name: pkg.name,
    description: pkg.description ?? '',
    credits: String(cloudProductIncludedCredits(pkg) || ''),
    usdAmount: formatMinorAmount(oneTimeUsdPrice(pkg)?.amount),
    sortOrder: String(pkg.sortOrder),
  }
}

export function CreditPackageForm({
  editing,
  form,
  available,
  pending,
  onFormChange,
  onCancel,
  onSubmit,
}: {
  editing: CloudProduct | null
  form: CreditPackageFormState
  available: boolean
  pending: boolean
  onFormChange: (form: CreditPackageFormState) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const creditsValid = creditsFromValue(form.credits) > 0
  const priceValid = convertCurrencyAmount(form.usdAmount) > 0

  return (
    <div className="space-y-4">
      <PackageIdentityFields form={form} onFormChange={onFormChange} />
      <NumberField
        label={t('admin.cloudStore.creditAmount')}
        id="creditPackageAmount"
        min="1"
        step="1"
        value={form.credits}
        onChange={(credits) => onFormChange({ ...form, credits })}
      />
      <NumberField
        label={t('admin.cloudStore.usdAmount')}
        id="creditPackageUsdAmount"
        min="0.01"
        step="0.01"
        value={form.usdAmount}
        onChange={(usdAmount) => onFormChange({ ...form, usdAmount })}
      />
      <PackageFormActions
        editing={editing}
        available={available && creditsValid && priceValid}
        pending={pending}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
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
  const quotaValid = storageBytes > 0
  const pricesValid = packagePriceInputsValid(form)

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
      <NumberField
        label={t('admin.cloudStore.includedCredits')}
        id="packageIncludedCredits"
        min="0"
        step="1"
        value={form.includedCredits}
        onChange={(includedCredits) => onFormChange({ ...form, includedCredits })}
      />
      {!quotaValid && form.storageSize !== '' && (
        <p className="text-xs text-destructive">{t('admin.cloudStore.quotaRequired')}</p>
      )}
      <PackageAmountFields form={form} onFormChange={onFormChange} />
      <PackageFormActions
        editing={editing}
        available={available && quotaValid && pricesValid}
        pending={pending}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    </div>
  )
}

function packagePricesFromForm(form: PackageFormState) {
  return packagePricesForForm(form).filter((price) => Number.isFinite(price.amount) && price.amount > 0)
}

function creditsFromForm(form: PackageFormState) {
  return creditsFromValue(form.includedCredits)
}

function creditsFromValue(value: string) {
  const credits = Number(value)
  return Number.isSafeInteger(credits) && credits > 0 ? credits : 0
}

function packagePriceInputsValid(form: PackageFormState) {
  return convertCurrencyAmount(form.usdMonthlyAmount) > 0 || convertCurrencyAmount(form.usdYearlyAmount) > 0
}

function packagePricesForForm(form: PackageFormState) {
  const credits = creditsFromForm(form)
  const metadata = credits > 0 ? { creditGrantType: 'subscription_grant', creditAmount: String(credits) } : undefined
  return [
    {
      currency: 'usd' as const,
      amount: convertCurrencyAmount(form.usdMonthlyAmount),
      recurring: { interval: 'month' as const, intervalCount: 1 },
      ...(metadata ? { metadata } : {}),
    },
    {
      currency: 'usd' as const,
      amount: convertCurrencyAmount(form.usdYearlyAmount),
      recurring: { interval: 'year' as const, intervalCount: 1 },
      ...(metadata ? { metadata } : {}),
    },
  ]
}

function convertCurrencyAmount(amount: string): number {
  return Math.round(Number(amount) * 100)
}

function formatMinorAmount(minorAmount: number | undefined): string {
  return minorAmount === undefined ? '' : (minorAmount / 100).toString()
}

function recurringUsdPrice(pkg: CloudProduct, interval: 'month' | 'year') {
  return pkg.prices.find(
    (price) =>
      price.currency === 'usd' &&
      price.recurring?.interval === interval &&
      price.recurring.intervalCount === 1 &&
      price.recurring.usageType !== 'metered',
  )
}

function oneTimeUsdPrice(pkg: CloudProduct) {
  return pkg.prices.find((price) => price.currency === 'usd' && !price.recurring)
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function PackageIdentityFields<TForm extends { name: string; description: string }>({
  form,
  onFormChange,
}: {
  form: TForm
  onFormChange: (form: TForm) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Field label={t('admin.cloudStore.planName')} htmlFor="packageName">
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
        label={t('admin.cloudStore.usdMonthlyAmount')}
        id="packageUsdMonthlyAmount"
        min="0.01"
        step="0.01"
        value={form.usdMonthlyAmount}
        onChange={(usdMonthlyAmount) => onFormChange({ ...form, usdMonthlyAmount })}
      />
      <NumberField
        label={t('admin.cloudStore.usdYearlyAmount')}
        id="packageUsdYearlyAmount"
        min="0.01"
        step="0.01"
        value={form.usdYearlyAmount}
        onChange={(usdYearlyAmount) => onFormChange({ ...form, usdYearlyAmount })}
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
