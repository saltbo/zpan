import type { StorageUsageCategory, StorageUsageItem } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronRight, Cloud } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STORAGE_CATEGORY_META, StorageCleanupDialog } from '@/components/storage/storage-cleanup-dialog'
import { CheckoutConfirmDialog, type CheckoutSelection } from '@/components/store/checkout-confirm-dialog'
import { openCheckoutTab, resolveCheckoutSelection } from '@/components/store/checkout-navigation'
import { StoragePackages } from '@/components/store/storage-panels'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getStorageUsage, getUserQuota, listCloudProducts, listCloudStoreTargets } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

export function StoragePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { data: activeOrg } = useActiveOrganization()
  const orgId = activeOrg?.id ?? ''
  const [selectedCategory, setSelectedCategory] = useState<StorageUsageCategory | null>(null)
  const [plansOpen, setPlansOpen] = useState(false)
  const [checkoutSelection, setCheckoutSelection] = useState<CheckoutSelection | null>(null)

  const usageQuery = useQuery({
    queryKey: ['storage-usage', orgId],
    queryFn: getStorageUsage,
    enabled: !!orgId,
  })
  const quotaQuery = useQuery({
    queryKey: ['user', 'quota', orgId],
    queryFn: getUserQuota,
    enabled: !!orgId,
    retry: false,
  })
  const productsQuery = useQuery({ queryKey: ['cloud-store', 'packages'], queryFn: listCloudProducts, retry: false })
  const targetsQuery = useQuery({
    queryKey: ['cloud-store', 'targets'],
    queryFn: listCloudStoreTargets,
    enabled: productsQuery.isSuccess,
    retry: false,
  })

  const currentTarget = targetsQuery.data?.items.find((item) => item.orgId === orgId)
  const canManageBilling = targetsQuery.isSuccess && (currentTarget?.type !== 'team' || currentTarget?.role === 'owner')

  const displayBreakdowns = usageQuery.data?.breakdowns ?? []
  const categoryBytes = displayBreakdowns.reduce((sum, row) => sum + row.bytes, 0)
  const quotaBytes = usageQuery.data?.quotaBytes ?? 0
  const usedBytes = usageQuery.data?.usedBytes ?? categoryBytes
  const availableBytes = Math.max(0, quotaBytes - usedBytes)
  const fileCount = displayBreakdowns.reduce((sum, row) => sum + row.fileCount, 0)
  const planName = usageQuery.data?.currentPlan?.name ?? t('storage.freePlanName')

  function requestCheckout(packageId: string, priceId: string) {
    const selection = resolveCheckoutSelection(productsQuery.data?.items ?? [], packageId, priceId)
    if (selection) setCheckoutSelection(selection)
  }

  function startCheckout(packageId: string, priceId: string, promotionCode?: string) {
    openCheckoutTab({ action: 'checkout', packageId, priceId, promotionCode })
    setPlansOpen(false)
  }

  function openFileLocation(item: StorageUsageItem) {
    setSelectedCategory(null)
    if (item.source === 'trash') {
      navigate({ to: '/trash' })
      return
    }
    if (item.source === 'image_hosting') {
      navigate({ to: '/image-host' })
      return
    }
    navigate({ to: '/files', search: item.parentPath ? { path: item.parentPath } : {} })
  }

  if (usageQuery.isLoading) {
    return <p className="py-20 text-center text-muted-foreground">{t('common.loading')}</p>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('storage.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('storage.managementSubtitle')}</p>
        </div>
        <Button onClick={() => setPlansOpen(true)} disabled={!canManageBilling}>
          {t('storage.expandStorage')}
        </Button>
      </header>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-3xl font-semibold tabular-nums">{formatSize(usedBytes)}</span>
            <span className="ml-2 text-muted-foreground">/ {formatSize(quotaBytes)}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3">
            <span className="rounded-full bg-background p-2 text-primary shadow-sm">
              <Cloud className="size-4" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">{t('storage.currentPlan')}</p>
              <p className="text-sm font-medium">
                {planName} · {formatSize(quotaBytes)}
              </p>
            </div>
          </div>
        </div>

        <div
          role="img"
          className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted"
          aria-label={t('storage.usageAria', { used: formatSize(usedBytes), total: formatSize(quotaBytes) })}
        >
          {displayBreakdowns
            .filter((row) => row.bytes > 0)
            .map((row) => (
              <span
                key={row.category}
                style={{
                  width: `${quotaBytes > 0 ? (row.bytes / quotaBytes) * 100 : 0}%`,
                  backgroundColor: STORAGE_CATEGORY_META[row.category].color,
                }}
                title={`${t(`storage.category.${row.category}`)} · ${formatSize(row.bytes)}`}
              />
            ))}
          {availableBytes > 0 && <span className="flex-1" title={t('storage.available')} />}
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {displayBreakdowns
            .filter((row) => row.bytes > 0)
            .slice(0, 6)
            .map((row) => (
              <span key={row.category} className="flex items-center gap-1.5">
                <i
                  className="size-2 rounded-full"
                  style={{ backgroundColor: STORAGE_CATEGORY_META[row.category].color }}
                />
                {t(`storage.category.${row.category}`)}
              </span>
            ))}
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-muted-foreground/25" />
            {t('storage.available')} {formatSize(availableBytes)}
          </span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-end justify-between border-b px-6 py-5">
          <div>
            <h2 className="font-semibold">{t('storage.spaceUsage')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('storage.byFileType')}</p>
          </div>
          <span className="text-sm text-muted-foreground">{t('storage.fileCount', { count: fileCount })}</span>
        </div>
        <div>
          {displayBreakdowns.map((row) => {
            const meta = STORAGE_CATEGORY_META[row.category]
            const Icon = meta.icon
            return (
              <button
                type="button"
                key={row.category}
                className="flex w-full items-center gap-4 border-b px-6 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/45"
                onClick={() => setSelectedCategory(row.category)}
              >
                <span
                  className="flex size-10 items-center justify-center rounded-xl"
                  style={{ color: meta.color, backgroundColor: `${meta.color}18` }}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium">{t(`storage.category.${row.category}`)}</strong>
                  <small className="text-muted-foreground">{t('storage.fileCount', { count: row.fileCount })}</small>
                </span>
                <span className="text-sm font-medium tabular-nums">{formatSize(row.bytes)}</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            )
          })}
        </div>
      </section>

      <StorageCleanupDialog
        category={selectedCategory}
        breakdowns={displayBreakdowns}
        onCategoryChange={setSelectedCategory}
        onOpenLocation={openFileLocation}
        onOpenChange={(open) => !open && setSelectedCategory(null)}
      />

      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('storage.availablePlansTitle')}</DialogTitle>
            <DialogDescription>{t('storage.availablePlansDescription')}</DialogDescription>
          </DialogHeader>
          <StoragePackages
            packages={productsQuery.data?.items ?? []}
            disabled={!orgId}
            currentPlan={quotaQuery.data?.currentPlan ?? null}
            showHeader={false}
            onCheckout={requestCheckout}
            onManagePlan={() => openCheckoutTab({ action: 'portal' })}
          />
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
