import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  StorePackages,
  StoreRedeemAndHistory,
  StoreStatusMetrics,
  TargetSelect,
} from '@/components/store/quota-store-panels'
import {
  createQuotaCheckout,
  getUserQuota,
  listPurchasableQuotaPackages,
  listQuotaGrants,
  listQuotaStoreTargets,
  redeemQuotaCode,
} from '@/lib/api'

export const Route = createFileRoute('/_authenticated/store')({
  component: StorePage,
})

export function StorePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [targetOrgId, setTargetOrgId] = useState('')
  const [code, setCode] = useState('')
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
  const storeQuery = useQuery({
    queryKey: ['quota-store', 'packages'],
    queryFn: listPurchasableQuotaPackages,
    retry: false,
  })
  const targetsQuery = useQuery({
    queryKey: ['quota-store', 'targets'],
    queryFn: listQuotaStoreTargets,
    enabled: storeQuery.isSuccess,
    retry: false,
  })
  const grantsQuery = useQuery({
    queryKey: ['quota-store', 'grants'],
    queryFn: listQuotaGrants,
    enabled: storeQuery.isSuccess,
    retry: false,
  })
  const quotaQuery = useQuery({
    queryKey: ['user', 'quota'],
    queryFn: getUserQuota,
    enabled: storeQuery.isSuccess,
    retry: false,
  })
  const deliveredCheckoutCount =
    grantsQuery.data?.items.filter((grant) => grant.source === 'stripe' && grant.active).length ?? 0

  const targets = targetsQuery.data?.items ?? []
  useEffect(() => {
    if (!targetOrgId && targets[0]) setTargetOrgId(targets[0].orgId)
  }, [targetOrgId, targets])

  useEffect(() => {
    if (deliveredCheckoutCount > 0) queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
  }, [deliveredCheckoutCount, queryClient])

  useEffect(() => {
    if (!checkoutRefreshActive) return
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['quota-store', 'grants'] })
    }, 5000)
    const timeout = window.setTimeout(() => setCheckoutRefreshActive(false), 120000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [checkoutRefreshActive, queryClient])

  const checkoutMutation = useMutation({
    mutationFn: ({ packageId }: { packageId: string; checkoutWindow: Window | null }) =>
      createQuotaCheckout(packageId, targetOrgId),
    onSuccess: (result, variables) => {
      if (variables.checkoutWindow) {
        variables.checkoutWindow.location.href = result.checkoutUrl
      } else {
        window.location.assign(result.checkoutUrl)
      }
      setCheckoutRefreshActive(true)
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['quota-store', 'grants'] })
    },
    onError: (err, variables) => {
      variables.checkoutWindow?.close()
      toast.error(err.message)
    },
  })

  function startCheckout(packageId: string) {
    const checkoutWindow = window.open('about:blank', '_blank')
    if (checkoutWindow) checkoutWindow.opener = null
    checkoutMutation.mutate({ packageId, checkoutWindow })
  }

  const redemptionMutation = useMutation({
    mutationFn: () => redeemQuotaCode(code, targetOrgId),
    onSuccess: () => {
      setCode('')
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['quota-store', 'grants'] })
      toast.success(t('store.redeemed'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (storeQuery.isLoading || (storeQuery.isSuccess && targetsQuery.isLoading)) {
    return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  if (storeQuery.isError) {
    return (
      <div className="max-w-3xl space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t('store.title')}</h2>
        <div className="rounded-md border border-dashed p-8 text-sm text-muted-foreground">
          {t('store.unavailable')}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{t('store.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('store.subtitle')}</p>
        </div>
        <TargetSelect targets={targets} value={targetOrgId} onValueChange={setTargetOrgId} />
      </div>

      <StoreStatusMetrics quota={quotaQuery.data} />
      <StorePackages
        packages={storeQuery.data?.items ?? []}
        disabled={!targetOrgId || checkoutMutation.isPending}
        onCheckout={startCheckout}
      />
      <StoreRedeemAndHistory
        code={code}
        grants={grantsQuery.data?.items ?? []}
        redeemDisabled={!code || !targetOrgId || redemptionMutation.isPending}
        onCodeChange={setCode}
        onRedeem={() => redemptionMutation.mutate()}
      />
    </div>
  )
}
