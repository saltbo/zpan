import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  redeemCloudGiftCard,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { openNewTab } from '@/lib/browser-navigation'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

export function StoragePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)
  const { data: activeOrg } = useActiveOrganization()
  const cloudStoreQuery = useQuery({
    queryKey: ['cloud-store', 'packages'],
    queryFn: listCloudProducts,
    retry: false,
  })
  const targetOrgId = activeOrg?.id ?? ''
  const ordersQuery = useQuery({
    queryKey: ['cloud-store', 'orders', targetOrgId],
    queryFn: () => listCloudOrders(),
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
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
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
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
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const currentOrders = ordersQuery.data?.items ?? []
  const deliveredCheckoutCount = currentOrders.filter((order) => order.fulfillmentStatus === 'fulfilled').length
  const hasActivePlan = Boolean(
    quotaQuery.data?.currentPlan || quotaQuery.data?.storagePlanName || quotaQuery.data?.trafficPlanName,
  )
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

  function startCheckout(packageId: string, priceId: string) {
    openCheckoutTab({ action: 'checkout', packageId, priceId })
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
        <div className="flex flex-wrap justify-end gap-2">
          <CreditBalanceButton
            credits={credits}
            products={creditProductsQuery.data?.items ?? []}
            entries={creditLedgerQuery.data?.items ?? []}
            loading={creditLedgerQuery.isLoading}
            onRedeem={(code) => redeemMutation.mutate(code)}
            onCheckout={startCheckout}
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
      </div>

      {checkoutRefreshActive && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t('storage.checkoutPending')}
        </div>
      )}

      {hasActivePlan && quotaQuery.data ? (
        <CurrentPlanCard
          quota={quotaQuery.data}
          creditsBalance={creditsQuery.data?.balance}
          onManagePlan={managePlan}
          isManagingPlan={false}
        />
      ) : (
        <div className="space-y-6">
          <FreeQuotaCard quota={quotaQuery.data} />
          <StoragePackages
            packages={cloudStoreQuery.data?.items ?? []}
            disabled={!targetOrgId}
            onCheckout={startCheckout}
          />
        </div>
      )}
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
    </div>
  )
}

type CheckoutTabInput =
  | { action: 'checkout'; packageId: string; priceId: string }
  | { action: 'payment'; orderId: string }
  | { action: 'portal' }

function openCheckoutTab(input: CheckoutTabInput) {
  const search = new URLSearchParams({ action: input.action })
  if (input.action === 'checkout') {
    search.set('packageId', input.packageId)
    search.set('priceId', input.priceId)
  }
  if (input.action === 'payment') search.set('orderId', input.orderId)
  openNewTab(`/store/checkout?${search.toString()}`)
}

function isCloudStoreDisabledError(error: unknown) {
  return error instanceof ApiError && error.body.error === 'quota_store_disabled'
}
