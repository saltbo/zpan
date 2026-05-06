import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Gift, HardDrive, ShoppingCart } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { StorageActions, StorageGrantHistory, StorageStatusMetrics } from '@/components/store/storage-panels'
import { Card, CardContent } from '@/components/ui/card'
import {
  ApiError,
  createQuotaCheckout,
  getUserQuota,
  listPurchasableQuotaPackages,
  listQuotaGrants,
  listQuotaStoreTargets,
  redeemQuotaCode,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

export function StoragePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
  const { data: activeOrg } = useActiveOrganization()
  const storagePlansQuery = useQuery({
    queryKey: ['storage-plans', 'packages'],
    queryFn: listPurchasableQuotaPackages,
    retry: false,
  })
  const targetsQuery = useQuery({
    queryKey: ['storage-plans', 'targets'],
    queryFn: listQuotaStoreTargets,
    enabled: storagePlansQuery.isSuccess,
    retry: false,
  })
  const targets = targetsQuery.data?.items ?? []
  const targetOrgId = activeOrg?.id ?? targets.find((target) => target.type === 'personal')?.orgId ?? ''
  const grantsQuery = useQuery({
    queryKey: ['storage-plans', 'grants', targetOrgId],
    queryFn: listQuotaGrants,
    enabled: storagePlansQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const quotaQuery = useQuery({
    queryKey: ['user', 'quota', targetOrgId],
    queryFn: getUserQuota,
    enabled: storagePlansQuery.isSuccess && !!targetOrgId,
    retry: false,
  })
  const currentGrants = (grantsQuery.data?.items ?? []).filter((grant) => grant.orgId === targetOrgId)
  const deliveredCheckoutCount = currentGrants.filter((grant) => grant.source === 'stripe' && grant.active).length

  useEffect(() => {
    if (deliveredCheckoutCount > 0) queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
  }, [deliveredCheckoutCount, queryClient])

  useEffect(() => {
    if (!checkoutRefreshActive) return
    const interval = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['storage-plans', 'grants'] })
    }, 5000)
    const timeout = window.setTimeout(() => setCheckoutRefreshActive(false), 120000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [checkoutRefreshActive, queryClient])

  const checkoutMutation = useMutation({
    mutationFn: ({
      packageId,
      currency,
    }: {
      packageId: string
      currency: 'usd' | 'cny'
      checkoutWindow: Window | null
    }) => createQuotaCheckout(packageId, targetOrgId, currency),
    onSuccess: (result, variables) => {
      if (variables.checkoutWindow) {
        variables.checkoutWindow.location.href = result.checkoutUrl
      } else {
        window.location.assign(result.checkoutUrl)
      }
      setCheckoutRefreshActive(true)
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['storage-plans', 'grants'] })
    },
    onError: (err, variables) => {
      variables.checkoutWindow?.close()
      toast.error(err.message)
    },
  })

  function startCheckout(packageId: string, currency: 'usd' | 'cny') {
    const checkoutWindow = window.open('about:blank', '_blank')
    if (checkoutWindow) checkoutWindow.opener = null
    checkoutMutation.mutate({ packageId, currency, checkoutWindow })
  }

  const redemptionMutation = useMutation({
    mutationFn: () => redeemQuotaCode(code, targetOrgId),
    onSuccess: () => {
      setCode('')
      queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
      queryClient.invalidateQueries({ queryKey: ['storage-plans', 'grants'] })
      toast.success(t('storage.redeemed'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (storagePlansQuery.isLoading || (storagePlansQuery.isSuccess && targetsQuery.isLoading)) {
    return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  if (storagePlansQuery.isError) {
    const disabled = isStoragePlansDisabledError(storagePlansQuery.error)
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
          code={code}
          packages={storagePlansQuery.data?.items ?? []}
          packagesDisabled={!targetOrgId || checkoutMutation.isPending}
          redeemDisabled={!code || !targetOrgId || redemptionMutation.isPending}
          onCodeChange={setCode}
          onCheckout={startCheckout}
          onRedeem={() => redemptionMutation.mutate()}
        />
      </div>

      <StorageStatusMetrics quota={quotaQuery.data} />
      <StorageGrantHistory grants={currentGrants} />
    </div>
  )
}

function isStoragePlansDisabledError(error: unknown) {
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
