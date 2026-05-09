import type { CloudWalletTransaction } from '@shared/schemas'
import { Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { StorageActions } from './storage-dialogs'

export function WalletBalanceButton({
  wallet,
  transactions,
  loading,
  onRedeem,
  isRedeeming,
}: {
  wallet?: { balance: number; currency: string }
  transactions: CloudWalletTransaction[]
  loading: boolean
  onRedeem: (code: string) => void
  isRedeeming: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? 'en'
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          aria-label={t('storage.viewWalletTransactions')}
        >
          <Wallet className="h-4 w-4" />
          {t('storage.walletButton')}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('storage.walletButton')}</DialogTitle>
          <DialogDescription>{t('storage.walletTransactionsDescription')}</DialogDescription>
        </DialogHeader>
        <WalletBalanceSummary wallet={wallet} language={language} onRedeem={onRedeem} isRedeeming={isRedeeming} />
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('storage.walletTransactionsTitle')}</h3>
          <WalletTransactions entries={transactions} language={language} loading={loading} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WalletBalanceSummary({
  wallet,
  language,
  onRedeem,
  isRedeeming,
}: {
  wallet?: { balance: number; currency: string }
  language: string
  onRedeem: (code: string) => void
  isRedeeming: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{t('storage.walletBalance')}</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">
          {wallet ? formatMoney(wallet.balance, wallet.currency, language) : t('common.loading')}
        </div>
      </div>
      <StorageActions onRedeem={onRedeem} isRedeeming={isRedeeming} />
    </div>
  )
}

function WalletTransactions({
  entries,
  language,
  loading,
}: {
  entries: CloudWalletTransaction[]
  language: string
  loading: boolean
}) {
  const { t } = useTranslation()

  if (loading) return <WalletEmptyState label={t('common.loading')} />
  if (entries.length === 0) return <WalletEmptyState label={t('storage.walletTransactionsEmpty')} />

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border">
      <table className="w-full caption-bottom text-left text-sm">
        <thead className="sticky top-0 border-b bg-background">
          <tr>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.walletTableType')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.walletTableChange')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.walletTableStatus')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.walletTableReference')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.walletTableDate')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b last:border-0">
              <td className="p-3 align-middle font-medium">{walletSourceLabel(entry.sourceType, t)}</td>
              <td
                className={`p-3 align-middle font-mono font-semibold ${
                  entry.direction === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                }`}
              >
                {entry.direction === 'credit' ? '+' : '-'}
                {formatMoney(entry.amount, entry.currency, language)}
              </td>
              <td className="p-3 align-middle">
                <Badge variant="outline">{walletStatusLabel(entry.status, t)}</Badge>
              </td>
              <td className="p-3 align-middle text-muted-foreground">{walletReference(entry)}</td>
              <td className="p-3 align-middle text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WalletEmptyState({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>
}

function formatMoney(amount: number, currency: string, language: string) {
  return new Intl.NumberFormat(language, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
}

function walletSourceLabel(
  sourceType: CloudWalletTransaction['sourceType'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (sourceType) {
    case 'gift_card_redemption':
      return t('storage.walletSourceGiftCard')
    case 'order_payment':
      return t('storage.walletSourceOrderPayment')
    case 'stripe_invoice':
      return t('storage.walletSourceStripeInvoice')
    case 'adjustment':
      return t('storage.walletSourceAdjustment')
    case 'refund':
      return t('storage.walletSourceRefund')
  }
}

function walletStatusLabel(status: CloudWalletTransaction['status'], t: ReturnType<typeof useTranslation>['t']) {
  switch (status) {
    case 'posted':
      return t('storage.walletStatusPosted')
    case 'pending':
      return t('storage.walletStatusPending')
    case 'released':
      return t('storage.walletStatusReleased')
    case 'refunded':
      return t('storage.walletStatusRefunded')
  }
}

function walletReference(entry: CloudWalletTransaction) {
  if (entry.paymentId) return entry.paymentId.slice(0, 8)
  if (entry.orderId) return entry.orderId.slice(0, 8)
  if (entry.sourceId) return entry.sourceId.slice(0, 8)
  return '-'
}
