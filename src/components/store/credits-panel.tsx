import type { CloudCreditLedgerEntry } from '@shared/schemas'
import { BadgeCent } from 'lucide-react'
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

export function CreditBalanceButton({
  credits,
  entries,
  loading,
  onRedeem,
  isRedeeming,
}: {
  credits?: { balance: number }
  entries: CloudCreditLedgerEntry[]
  loading: boolean
  onRedeem: (code: string) => void
  isRedeeming: boolean
}) {
  const { t } = useTranslation()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground"
          aria-label={t('storage.viewCreditActivity')}
        >
          <BadgeCent className="h-4 w-4" />
          {t('storage.creditsButton')}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('storage.creditsButton')}</DialogTitle>
          <DialogDescription>{t('storage.creditActivityDescription')}</DialogDescription>
        </DialogHeader>
        <CreditBalanceSummary credits={credits} onRedeem={onRedeem} isRedeeming={isRedeeming} />
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('storage.creditActivityTitle')}</h3>
          <CreditActivity entries={entries} loading={loading} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreditBalanceSummary({
  credits,
  onRedeem,
  isRedeeming,
}: {
  credits?: { balance: number }
  onRedeem: (code: string) => void
  isRedeeming: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{t('storage.creditBalance')}</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">
          {credits ? formatCredits(credits.balance) : t('common.loading')}
        </div>
      </div>
      <StorageActions onRedeem={onRedeem} isRedeeming={isRedeeming} />
    </div>
  )
}

function CreditActivity({ entries, loading }: { entries: CloudCreditLedgerEntry[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) return <CreditEmptyState label={t('common.loading')} />
  if (entries.length === 0) return <CreditEmptyState label={t('storage.creditActivityEmpty')} />

  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border">
      <table className="w-full caption-bottom text-left text-sm">
        <thead className="sticky top-0 border-b bg-background">
          <tr>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableType')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableChange')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableStatus')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableReference')}</th>
            <th className="h-10 px-3 font-medium text-muted-foreground">{t('storage.creditTableDate')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b last:border-0">
              <td className="p-3 align-middle font-medium">{creditSourceLabel(entry.sourceType, t)}</td>
              <td
                className={`p-3 align-middle font-mono font-semibold ${
                  entry.direction === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                }`}
              >
                {entry.direction === 'credit' ? '+' : '-'}
                {formatCredits(entry.amount)}
              </td>
              <td className="p-3 align-middle">
                <Badge variant="outline">{creditStatusLabel(entry.status, t)}</Badge>
              </td>
              <td className="p-3 align-middle text-muted-foreground">{creditReference(entry)}</td>
              <td className="p-3 align-middle text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreditEmptyState({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>
}

function formatCredits(amount: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount)
}

function creditSourceLabel(
  sourceType: CloudCreditLedgerEntry['sourceType'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (sourceType) {
    case 'subscription_grant':
      return t('storage.creditSourceSubscriptionGrant')
    case 'top_up':
      return t('storage.creditSourceTopUp')
    case 'gift_card_redemption':
      return t('storage.creditSourceGiftCard')
    case 'admin_grant':
      return t('storage.creditSourceAdminGrant')
    case 'usage_charge':
      return t('storage.creditSourceUsageCharge')
    case 'adjustment':
      return t('storage.creditSourceAdjustment')
  }
}

function creditStatusLabel(status: CloudCreditLedgerEntry['status'], t: ReturnType<typeof useTranslation>['t']) {
  switch (status) {
    case 'posted':
      return t('storage.creditStatusPosted')
    case 'reversed':
      return t('storage.creditStatusReversed')
  }
}

function creditReference(entry: CloudCreditLedgerEntry) {
  if (entry.paymentId) return entry.paymentId.slice(0, 8)
  if (entry.orderId) return entry.orderId.slice(0, 8)
  if (entry.sourceId) return entry.sourceId.slice(0, 8)
  return '-'
}
