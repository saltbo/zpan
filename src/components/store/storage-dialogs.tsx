import type { QuotaStorePackage } from '@shared/types'
import { Activity, Gift, HardDrive, PlusCircle, ShoppingCart } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatSize } from '@/lib/format'

export function StorageActions({
  code,
  packages,
  packagesDisabled,
  redeemDisabled,
  onCodeChange,
  onCheckout,
  onRedeem,
}: {
  code: string
  packages: QuotaStorePackage[]
  packagesDisabled: boolean
  redeemDisabled: boolean
  onCodeChange: (code: string) => void
  onCheckout: (packageId: string, currency: 'usd' | 'cny') => void
  onRedeem: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <StorageDialogButton icon={<Gift />} label={t('storage.redeemTitle')}>
        <RedeemPanel code={code} disabled={redeemDisabled} onCodeChange={onCodeChange} onRedeem={onRedeem} />
      </StorageDialogButton>
      <StorageDialogButton icon={<ShoppingCart />} label={t('storage.packagesTitle')} wide>
        <PackagePanel packages={packages} disabled={packagesDisabled} onCheckout={onCheckout} />
      </StorageDialogButton>
    </div>
  )
}

function StorageDialogButton({
  icon,
  label,
  wide = false,
  children,
}: {
  icon: ReactNode
  label: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className={wide ? 'gap-4 p-5 sm:max-w-xl' : 'gap-4 p-5 sm:max-w-[340px]'}>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function RedeemPanel({
  code,
  disabled,
  onCodeChange,
  onRedeem,
}: {
  code: string
  disabled: boolean
  onCodeChange: (code: string) => void
  onRedeem: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <DialogHeader className="text-left">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Gift className="size-4" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base">{t('storage.redeemTitle')}</DialogTitle>
            <DialogDescription className="text-xs leading-5">{t('storage.redeemDescription')}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="storageCode" className="text-xs">
            {t('storage.storageCode')}
          </Label>
          <Input
            id="storageCode"
            className="h-9 font-mono text-sm tracking-wider uppercase"
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
          />
        </div>
        <Button className="h-9 w-full text-sm" disabled={disabled} onClick={onRedeem}>
          {t('storage.redeemButton')}
        </Button>
      </div>
    </>
  )
}

function PackagePanel({
  packages,
  disabled,
  onCheckout,
}: {
  packages: QuotaStorePackage[]
  disabled: boolean
  onCheckout: (packageId: string, currency: 'usd' | 'cny') => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <DialogHeader className="space-y-1">
        <DialogTitle className="text-base">{t('storage.packagesTitle')}</DialogTitle>
        <DialogDescription className="text-xs leading-5">{t('storage.packagesDescription')}</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[56vh] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
        {packages.map((pkg) => (
          <PackageOption
            key={pkg.id}
            pkg={pkg}
            disabled={disabled}
            onCheckout={(currency) => onCheckout(pkg.id, currency)}
          />
        ))}
        {packages.length === 0 && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2">
            {t('storage.noPackages')}
          </div>
        )}
      </div>
    </>
  )
}

function PackageOption({
  pkg,
  disabled,
  onCheckout,
}: {
  pkg: QuotaStorePackage
  disabled: boolean
  onCheckout: (currency: 'usd' | 'cny') => void
}) {
  const { t } = useTranslation()
  const Icon = pkg.resourceType === 'storage' ? HardDrive : Activity
  return (
    <div className="group flex flex-col justify-between rounded-md border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/30">
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium leading-none">{pkg.name}</p>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{pkg.description}</p>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
            <Icon className="size-3.5" />
          </div>
        </div>
        <div>
          <p className="text-xl font-semibold tracking-normal">{formatSize(pkg.resourceBytes)}</p>
          <p className="text-xs text-muted-foreground">{formatPrices(pkg.prices)}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5">
        {pkg.prices.map((price) => (
          <Button
            key={price.currency}
            className="h-8 w-full text-xs"
            disabled={disabled}
            onClick={() => onCheckout(price.currency)}
          >
            <PlusCircle className="mr-1.5 size-3.5" />
            {t('storage.checkout')} · {formatMoney(price.amount, price.currency)}
          </Button>
        ))}
      </div>
    </div>
  )
}

function formatPrices(prices: QuotaStorePackage['prices']) {
  return prices.map((price) => formatMoney(price.amount, price.currency)).join(' / ')
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`
}
