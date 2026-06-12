import type { CloudProduct } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckoutConfirmDialog, type CheckoutSelection } from '@/components/store/checkout-confirm-dialog'
import {
  CreditBalanceButton,
  CurrentPlanCard,
  FreeQuotaCard,
  StorageOrderHistoryDialog,
  StoragePackages,
  StorageUnavailableState,
} from '@/components/store/storage-panels'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ApiError,
  cancelCloudOrder,
  getCloudCredits,
  getUserQuota,
  listCloudCreditLedgerEntries,
  listCloudCreditProducts,
  listCloudOrders,
  listCloudProducts,
  listCloudStoreTargets,
  redeemCloudGiftCard,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { openNewTab } from '@/lib/browser-navigation'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

export function StoragePage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null)
  const { data: activeOrg } = useActiveOrganization()
  const cloudStoreQuery = useQuery({
    queryKey: ['cloud-store', 'packages'],
    queryFn: listCloudProducts,
    retry: false,
  })
  const targetOrgId = activeOrg?.id ?? ''
  const targetsQuery = useQuery({
    queryKey: ['cloud-store', 'targets'],
    queryFn: listCloudStoreTargets,
    enabled: cloudStoreQuery.isSuccess,
    retry: false,
  })
  // Billing surfaces are owner-only for team spaces (server enforces the same
  // rule); members get a read-only view with guidance instead of buy buttons.
  const currentTarget = targetsQuery.data?.items.find((item) => item.orgId === targetOrgId)
  const isTeamSpace = currentTarget?.type === 'team'
  const canManageBilling = targetsQuery.isSuccess && (!isTeamSpace || currentTarget?.role === 'owner')
  const ordersQuery = useQuery({
    queryKey: ['cloud-store', 'orders', targetOrgId],
    queryFn: () => listCloudOrders(),
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })
  const quotaQuery = useQuery({
    queryKey: ['user', 'quota', targetOrgId],
    queryFn: getUserQuota,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const creditsQuery = useQuery({
    queryKey: ['cloud-store', 'credits', targetOrgId],
    queryFn: getCloudCredits,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })
  const creditProductsQuery = useQuery({
    queryKey: ['cloud-store', 'credits', 'products'],
    queryFn: listCloudCreditProducts,
    enabled: cloudStoreQuery.isSuccess,
    retry: false,
  })
  const creditLedgerQuery = useQuery({
    queryKey: ['cloud-store', 'credits', 'ledger-entries', targetOrgId],
    queryFn: listCloudCreditLedgerEntries,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })
  const currentOrders = ordersQuery.data?.items ?? []
  const deliveredCheckoutCount = currentOrders.filter((order) => order.fulfillmentStatus === 'fulfilled').length
  const hasActiveSubscription = quotaQuery.data?.currentPlan?.subscription === true
  const credits = creditsQuery.data ? { balance: creditsQuery.data.balance } : undefined

  useEffect(() => {
    if (deliveredCheckoutCount > 0) queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
  }, [deliveredCheckoutCount, queryClient])

  useEffect(() => {
    if (!checkoutRefreshActive) return
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'credits'] })
    }, 5000)
    const timeout = window.setTimeout(() => setCheckoutRefreshActive(false), 120000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [checkoutRefreshActive, queryClient])

  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => cancelCloudOrder(orderId),
    onSuccess: () => {
      toast.success(t('storage.cancelSuccess'))
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'credits'] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const redeemMutation = useMutation({
    mutationFn: (code: string) => redeemCloudGiftCard(code),
    onSuccess: (result) => {
      toast.success(
        t('storage.redeemSuccess', {
          amount: result.redeemedCredits,
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'credits'] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function requestCheckout(packageId: string, priceId: string) {
    const products = [...(cloudStoreQuery.data?.items ?? []), ...(creditProductsQuery.data?.items ?? [])]
    const selection = resolveCheckoutSelection(products, packageId, priceId)
    if (!selection) {
      startCheckout(packageId, priceId)
      return
    }
    setCheckoutSelection(selection)
  }

  function startCheckout(packageId: string, priceId: string, promotionCode?: string) {
    openCheckoutTab({ action: 'checkout', packageId, priceId, promotionCode })
    setCheckoutRefreshActive(true)
    queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
    queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
  }

  function continuePayment(orderId: string) {
    openCheckoutTab({ action: 'payment', orderId })
    setCheckoutRefreshActive(true)
    queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
  }

  function managePlan() {
    openCheckoutTab({ action: 'portal' })
  }

  function cancelOrder(orderId: string) {
    setCancelOrderId(orderId)
  }

  function confirmCancelOrder() {
    if (!cancelOrderId) return
    cancelOrderMutation.mutate(cancelOrderId, {
      onSuccess: () => {
        setCancelOrderId(null)
      },
    })
  }

  if (cloudStoreQuery.isLoading) {
    return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  if (cloudStoreQuery.isError) {
    const disabled = isCloudStoreDisabledError(cloudStoreQuery.error)
    return <StorageUnavailableState disabled={disabled} />
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t('storage.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('storage.subtitle')}</p>
        </div>
        {canManageBilling && (
          <div className="flex flex-wrap justify-end gap-2">
            <CreditBalanceButton
              credits={credits}
              products={creditProductsQuery.data?.items ?? []}
              entries={creditLedgerQuery.data?.items ?? []}
              loading={creditLedgerQuery.isLoading}
              onRedeem={(code) => redeemMutation.mutate(code)}
              onCheckout={requestCheckout}
              isRedeeming={redeemMutation.isPending}
              checkoutDisabled={!targetOrgId}
            />
            <StorageOrderHistoryDialog
              orders={currentOrders}
              onContinuePayment={continuePayment}
              onCancelOrder={cancelOrder}
              continuingOrderId={null}
              cancelingOrderId={cancelOrderMutation.isPending ? cancelOrderMutation.variables : null}
            />
          </div>
        )}
      </div>

      {checkoutRefreshActive && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t('storage.checkoutPending')}
        </div>
      )}

      <div className="space-y-6">
        {hasActiveSubscription && quotaQuery.data ? (
          <CurrentPlanCard
            quota={quotaQuery.data}
            creditsBalance={creditsQuery.data?.balance}
            onManagePlan={canManageBilling ? managePlan : undefined}
            isManagingPlan={false}
          />
        ) : (
          <FreeQuotaCard quota={quotaQuery.data} creditsBalance={creditsQuery.data?.balance} />
        )}
        {canManageBilling ? (
          <StoragePackages
            packages={cloudStoreQuery.data?.items ?? []}
            disabled={!targetOrgId}
            currentPlan={quotaQuery.data?.currentPlan ?? null}
            onCheckout={requestCheckout}
            onManagePlan={managePlan}
          />
        ) : (
          targetsQuery.isSuccess && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">{t('storage.teamMemberNotice')}</p>
            </div>
          )
        )}
      </div>
      <Dialog open={!!cancelOrderId} onOpenChange={(open) => !open && setCancelOrderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('storage.cancelOrder')}</DialogTitle>
            <DialogDescription>{t('storage.cancelConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOrderId(null)} disabled={cancelOrderMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmCancelOrder} disabled={cancelOrderMutation.isPending}>
              {cancelOrderMutation.isPending ? t('common.loading') : t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CheckoutConfirmDialog
        key={checkoutSelection?.priceId ?? 'none'}
        selection={checkoutSelection}
        language={i18n.resolvedLanguage ?? 'en'}
        onOpenChange={(open) => !open && setCheckoutSelection(null)}
        onConfirm={startCheckout}
      />
    </div>
  )
}

type CheckoutTabInput =
  | { action: 'checkout'; packageId: string; priceId: string; promotionCode?: string }
  | { action: 'payment'; orderId: string }
  | { action: 'portal' }

function openCheckoutTab(input: CheckoutTabInput) {
  const search = new URLSearchParams({ action: input.action })
  if (input.action === 'checkout') {
    search.set('packageId', input.packageId)
    search.set('priceId', input.priceId)
    if (input.promotionCode) search.set('promotionCode', input.promotionCode)
  }
  if (input.action === 'payment') search.set('orderId', input.orderId)
  openNewTab(`/store/checkout?${search.toString()}`)
}

function resolveCheckoutSelection(
  products: CloudProduct[],
  packageId: string,
  priceId: string,
): CheckoutSelection | null {
  const product = products.find((item) => item.id === packageId)
  const price = product?.prices.find((item) => item.id === priceId)
  if (!product || !price) return null
  const interval = price.recurring?.interval
  return {
    packageId,
    priceId,
    productName: product.name,
    amount: price.amount,
    currency: price.currency,
    interval: interval === 'month' || interval === 'year' ? interval : null,
  }
}

function isCloudStoreDisabledError(error: unknown) {
  return error instanceof ApiError && error.body.error === 'quota_store_disabled'
}
