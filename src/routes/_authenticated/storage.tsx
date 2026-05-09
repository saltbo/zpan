import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Gift, HardDrive, ShoppingCart } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { StorageActions, StorageOrderHistory, StorageStatusMetrics } from '@/components/store/storage-panels'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  continueCloudOrderPayment,
  createCloudBillingPortalSession,
  createCloudCheckout,
  getCloudWallet,
  getUserQuota,
  listCloudOrders,
  listCloudProducts,
  listCloudWalletTransactions,
  redeemCloudGiftCard,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

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
  const walletQuery = useQuery({
    queryKey: ['cloud-store', 'wallet', targetOrgId],
    queryFn: getCloudWallet,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const walletTransactionsQuery = useQuery({
    queryKey: ['cloud-store', 'wallet', 'transactions', targetOrgId],
    queryFn: listCloudWalletTransactions,
    enabled: cloudStoreQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const currentOrders = ordersQuery.data?.items ?? []
  const deliveredCheckoutCount = currentOrders.filter((order) => order.fulfillmentStatus === 'fulfilled').length
  const hasActivePlan = Boolean(quotaQuery.data?.storagePlanName || quotaQuery.data?.trafficPlanName)

  useEffect(() => {
    if (deliveredCheckoutCount > 0) queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
  }, [deliveredCheckoutCount, queryClient])

  useEffect(() => {
    if (!checkoutRefreshActive) return
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'wallet'] })
    }, 5000)
    const timeout = window.setTimeout(() => setCheckoutRefreshActive(false), 120000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [checkoutRefreshActive, queryClient])

  const checkoutMutation = useMutation({
    mutationFn: ({ packageId, currency }: { packageId: string; currency: string; checkoutWindow: Window | null }) =>
      createCloudCheckout(packageId, currency),
    onSuccess: (result, variables) => {
      if (variables.checkoutWindow) {
        variables.checkoutWindow.location.href = result.url
      } else {
        window.location.assign(result.url)
      }
      setCheckoutRefreshActive(true)
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
    },
    onError: (err, variables) => {
      variables.checkoutWindow?.close()
      toast.error(err.message)
    },
  })

  const continuePaymentMutation = useMutation({
    mutationFn: ({ orderId }: { orderId: string; checkoutWindow: Window | null }) => continueCloudOrderPayment(orderId),
    onSuccess: (result, variables) => {
      if (variables.checkoutWindow) {
        variables.checkoutWindow.location.href = result.url
      } else {
        window.location.assign(result.url)
      }
      setCheckoutRefreshActive(true)
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
    },
    onError: (err, variables) => {
      variables.checkoutWindow?.close()
      toast.error(err.message)
    },
  })

  const managePlanMutation = useMutation({
    mutationFn: (_variables: { checkoutWindow: Window | null }) => createCloudBillingPortalSession(),
    onSuccess: (result, variables) => {
      if (variables.checkoutWindow) {
        variables.checkoutWindow.location.href = result.url
      } else {
        window.location.assign(result.url)
      }
    },
    onError: (err, variables) => {
      variables.checkoutWindow?.close()
      toast.error(err.message)
    },
  })

  const cancelOrderMutation = useMutation({
    mutationFn: (orderId: string) => cancelCloudOrder(orderId),
    onSuccess: () => {
      toast.success(t('storage.cancelSuccess'))
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'wallet'] })
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
          amount: result.redeemedAmount / 100,
          currency: result.currency?.toUpperCase() ?? 'USD',
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['cloud-store', 'wallet'] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  function startCheckout(packageId: string, currency: string) {
    const checkoutWindow = window.open('about:blank', '_blank')
    if (checkoutWindow) checkoutWindow.opener = null
    checkoutMutation.mutate({ packageId, currency, checkoutWindow })
  }

  function continuePayment(orderId: string) {
    const checkoutWindow = window.open('about:blank', '_blank')
    if (checkoutWindow) checkoutWindow.opener = null
    continuePaymentMutation.mutate({ orderId, checkoutWindow })
  }

  function managePlan() {
    const checkoutWindow = window.open('about:blank', '_blank')
    if (checkoutWindow) checkoutWindow.opener = null
    managePlanMutation.mutate({ checkoutWindow })
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
        <StorageActions
          packages={cloudStoreQuery.data?.items ?? []}
          packagesDisabled={!targetOrgId || checkoutMutation.isPending}
          onCheckout={startCheckout}
          onManagePlan={managePlan}
          onRedeem={(code) => redeemMutation.mutate(code)}
          isRedeeming={redeemMutation.isPending}
          hasActivePlan={hasActivePlan}
          isManagingPlan={managePlanMutation.isPending}
        />
      </div>

      {checkoutRefreshActive && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t('storage.checkoutPending')}
        </div>
      )}

      <StorageStatusMetrics
        quota={quotaQuery.data}
        wallet={
          walletQuery.data
            ? {
                balance: walletQuery.data.balances[0]?.availableAmount ?? 0,
                currency: walletQuery.data.balances[0]?.currency ?? 'usd',
              }
            : undefined
        }
        walletTransactions={walletTransactionsQuery.data?.items ?? []}
        walletTransactionsLoading={walletTransactionsQuery.isLoading}
      />
      <StorageOrderHistory
        orders={currentOrders}
        onContinuePayment={continuePayment}
        onCancelOrder={cancelOrder}
        continuingOrderId={continuePaymentMutation.isPending ? continuePaymentMutation.variables?.orderId : null}
        cancelingOrderId={cancelOrderMutation.isPending ? cancelOrderMutation.variables : null}
      />
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

function isCloudStoreDisabledError(error: unknown) {
  return error instanceof ApiError && error.body.error === 'quota_store_disabled'
}

function StorageUnavailableState({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('storage.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {disabled ? t('storage.disabledSubtitle') : t('storage.unavailable')}
        </p>
      </div>

      <Card className="border-border/60">
        <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_1.25fr] md:items-center">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
              <HardDrive className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium">
                {disabled ? t('storage.disabledTitle') : t('storage.unavailableTitle')}
              </h3>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                {disabled ? t('storage.disabledDescription') : t('storage.unavailableDescription')}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <UnavailablePoint icon={<ShoppingCart />} label={t('storage.disabledBuying')} />
            <UnavailablePoint icon={<Gift />} label={t('storage.disabledRedeeming')} />
            <UnavailablePoint icon={<HardDrive />} label={t('storage.disabledExistingStorage')} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function UnavailablePoint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background px-4 py-3 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  )
}
