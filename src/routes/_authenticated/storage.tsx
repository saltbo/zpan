import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckoutConfirmDialog, type CheckoutSelection } from '@/components/store/checkout-confirm-dialog'
import { openCheckoutTab, resolveCheckoutSelection } from '@/components/store/checkout-navigation'
import {
  CurrentPlanCard,
  FreeQuotaCard,
  StoragePackages,
  StorageUnavailableState,
} from '@/components/store/storage-panels'
import { ApiError, getCloudCredits, getUserQuota, listCloudProducts, listCloudStoreTargets } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

export function StoragePage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [checkoutRefreshActive, setCheckoutRefreshActive] = useState(false)
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
  const hasActiveSubscription = quotaQuery.data?.currentPlan?.subscription === true

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

  function requestCheckout(packageId: string, priceId: string) {
    const selection = resolveCheckoutSelection(cloudStoreQuery.data?.items ?? [], packageId, priceId)
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

  function managePlan() {
    openCheckoutTab({ action: 'portal' })
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
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('storage.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('storage.subtitle')}</p>
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

function isCloudStoreDisabledError(error: unknown) {
  return (
    error instanceof ApiError && error.reason === 'FEATURE_NOT_AVAILABLE' && error.metadata?.feature === 'quota_store'
  )
}
