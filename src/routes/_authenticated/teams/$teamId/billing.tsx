import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckoutConfirmDialog, type CheckoutSelection } from '@/components/store/checkout-confirm-dialog'
import { openCheckoutTab, resolveCheckoutSelection } from '@/components/store/checkout-navigation'
import {
  CreditBillingPanel,
  StorageOrderHistoryDialog,
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
  listCloudCreditLedgerEntries,
  listCloudCreditProducts,
  listCloudOrders,
  listCloudProducts,
  listCloudStoreTargets,
  redeemCloudGiftCard,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/teams/$teamId/billing')({
  component: WorkspaceBillingPage,
})

export function WorkspaceBillingPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { data: activeOrg } = useActiveOrganization()
  const targetOrgId = activeOrg?.id ?? ''
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null)
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)

  const cloudStoreQuery = useQuery({
    queryKey: ['cloud-store', 'packages'],
    queryFn: listCloudProducts,
    retry: false,
  })
  const targetsQuery = useQuery({
    queryKey: ['cloud-store', 'targets'],
    queryFn: listCloudStoreTargets,
    enabled: cloudStoreQuery.isSuccess,
    retry: false,
  })
  const currentTarget = targetsQuery.data?.items.find((item) => item.orgId === targetOrgId)
  const isTeamSpace = currentTarget?.type === 'team'
  const canManageBilling = targetsQuery.isSuccess && (!isTeamSpace || currentTarget?.role === 'owner')
  const creditsQuery = useQuery({
    queryKey: ['cloud-store', 'credits', targetOrgId],
    queryFn: getCloudCredits,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })
  const creditProductsQuery = useQuery({
    queryKey: ['cloud-store', 'credits', 'products'],
    queryFn: listCloudCreditProducts,
    enabled: cloudStoreQuery.isSuccess && canManageBilling,
    retry: false,
  })
  const creditLedgerQuery = useQuery({
    queryKey: ['cloud-store', 'credits', 'ledger-entries', targetOrgId],
    queryFn: listCloudCreditLedgerEntries,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })
  const ordersQuery = useQuery({
    queryKey: ['cloud-store', 'orders', targetOrgId],
    queryFn: () => listCloudOrders(),
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId && canManageBilling,
    retry: false,
  })

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

  const redeemMutation = useMutation({
    mutationFn: (code: string) => redeemCloudGiftCard(code),
    onSuccess: (result) => {
      toast.success(t('storage.redeemSuccess', { amount: result.redeemedCredits }))
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'credits'] })
    },
    onError: (error) => toast.error(error.message),
  })
  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => cancelCloudOrder(orderId),
    onSuccess: () => {
      toast.success(t('storage.cancelSuccess'))
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'credits'] })
      setCancelOrderId(null)
    },
    onError: (error) => toast.error(error.message),
  })

  function requestCheckout(packageId: string, priceId: string) {
    const selection = resolveCheckoutSelection(creditProductsQuery.data?.items ?? [], packageId, priceId)
    if (!selection) {
      startCheckout(packageId, priceId)
      return
    }
    setCheckoutSelection(selection)
  }

  function startCheckout(packageId: string, priceId: string, promotionCode?: string) {
    openCheckoutTab({ action: 'checkout', packageId, priceId, promotionCode })
    setCheckoutRefreshActive(true)
    queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
  }

  function continuePayment(orderId: string) {
    openCheckoutTab({ action: 'payment', orderId })
    setCheckoutRefreshActive(true)
    queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
  }

  if (cloudStoreQuery.isLoading) {
    return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  if (cloudStoreQuery.isError) {
    const disabled =
      cloudStoreQuery.error instanceof ApiError &&
      cloudStoreQuery.error.reason === 'FEATURE_NOT_AVAILABLE' &&
      cloudStoreQuery.error.metadata?.feature === 'quota_store'
    return <StorageUnavailableState disabled={disabled} />
  }

  return (
    <div className="max-w-6xl space-y-6 pb-8">
      {checkoutRefreshActive && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t('storage.checkoutPending')}
        </div>
      )}

      {canManageBilling ? (
        <CreditBillingPanel
          credits={creditsQuery.data}
          products={creditProductsQuery.data?.items ?? []}
          entries={creditLedgerQuery.data?.items ?? []}
          loading={creditLedgerQuery.isLoading}
          onRedeem={(code) => redeemMutation.mutate(code)}
          onCheckout={requestCheckout}
          isRedeeming={redeemMutation.isPending}
          checkoutDisabled={!targetOrgId}
          accountAction={
            <StorageOrderHistoryDialog
              orders={ordersQuery.data?.items ?? []}
              onContinuePayment={continuePayment}
              onCancelOrder={setCancelOrderId}
              cancelingOrderId={cancelOrderMutation.isPending ? cancelOrderMutation.variables : null}
            />
          }
        />
      ) : (
        targetsQuery.isSuccess && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('storage.teamMemberBillingNotice')}</p>
          </div>
        )
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
            <Button
              variant="destructive"
              onClick={() => cancelOrderId && cancelOrderMutation.mutate(cancelOrderId)}
              disabled={cancelOrderMutation.isPending}
            >
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
