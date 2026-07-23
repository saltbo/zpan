import type { StorageUsageCategory } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, ChevronRight, Cloud, File, FileText, Image, Images, Music, Trash2, Video } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckoutConfirmDialog, type CheckoutSelection } from '@/components/store/checkout-confirm-dialog'
import { openCheckoutTab, resolveCheckoutSelection } from '@/components/store/checkout-navigation'
import { StoragePackages } from '@/components/store/storage-panels'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  getStorageUsage,
  getUserQuota,
  listCloudProducts,
  listCloudStoreTargets,
  listStorageUsageItems,
} from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'

export const Route = createFileRoute('/_authenticated/storage')({
  component: StoragePage,
})

const CATEGORY_META: Record<StorageUsageCategory, { color: string; icon: typeof Image; manageHref: string }> = {
  photos: { color: '#f59e42', icon: Image, manageHref: '/files?type=photos' },
  videos: { color: '#7c5ce7', icon: Video, manageHref: '/files?type=videos' },
  music: { color: '#ec4899', icon: Music, manageHref: '/files?type=music' },
  documents: { color: '#3b82f6', icon: FileText, manageHref: '/files?type=documents' },
  archives: { color: '#14b8a6', icon: Archive, manageHref: '/files?type=archives' },
  other: { color: '#94a3b8', icon: File, manageHref: '/files?type=other' },
  image_hosting: { color: '#06b6d4', icon: Images, manageHref: '/image-host' },
  trash: { color: '#ef4444', icon: Trash2, manageHref: '/trash' },
}

export function StoragePage() {
  const { t, i18n } = useTranslation()
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
                  backgroundColor: CATEGORY_META[row.category].color,
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
                <i className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_META[row.category].color }} />
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
            const meta = CATEGORY_META[row.category]
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

      <CategoryDialog category={selectedCategory} onOpenChange={(open) => !open && setSelectedCategory(null)} />

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

function CategoryDialog({
  category,
  onOpenChange,
}: {
  category: StorageUsageCategory | null
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const itemsQuery = useQuery({
    queryKey: ['storage-usage', 'items', category],
    queryFn: () => listStorageUsageItems(category!, 1, 20),
    enabled: category !== null,
  })
  const meta = category ? CATEGORY_META[category] : null
  const Icon = meta?.icon ?? File
  const totalBytes = useMemo(
    () => itemsQuery.data?.items.reduce((sum, item) => sum + item.size, 0) ?? 0,
    [itemsQuery.data],
  )

  return (
    <Dialog open={category !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-5" style={{ color: meta?.color }} />
            {category ? t(`storage.category.${category}`) : ''}
          </DialogTitle>
          <DialogDescription>
            {t('storage.categorySummary', {
              count: itemsQuery.data?.total ?? 0,
              size: formatSize(totalBytes),
            })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[420px]">
          <div className="divide-y">
            {itemsQuery.isLoading && (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
            )}
            {itemsQuery.data?.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-3">
                <File className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{formatSize(item.size)}</span>
              </div>
            ))}
            {itemsQuery.data?.items.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">{t('storage.noFiles')}</p>
            )}
          </div>
        </ScrollArea>
        {meta && (
          <div className="flex justify-end">
            <Button asChild>
              <a href={meta.manageHref}>{t('storage.goManage')}</a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
