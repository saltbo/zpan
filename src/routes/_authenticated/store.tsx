import type { QuotaStorePackage, QuotaTarget } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Gift, HardDrive, PlusCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  createQuotaCheckout,
  listPurchasableQuotaPackages,
  listQuotaGrants,
  listQuotaStoreTargets,
  redeemQuotaCode,
} from '@/lib/api'
import { formatSize } from '@/lib/format'

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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(storeQuery.data?.items ?? []).map((pkg) => (
          <PackageCard
            key={pkg.id}
            pkg={pkg}
            disabled={!targetOrgId || checkoutMutation.isPending}
            onCheckout={() => startCheckout(pkg.id)}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              <CardTitle>{t('store.redeemTitle')}</CardTitle>
            </div>
            <CardDescription>{t('store.redeemDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="storageCode">{t('store.storageCode')}</Label>
              <Input id="storageCode" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button
              className="w-full"
              disabled={!code || !targetOrgId || redemptionMutation.isPending}
              onClick={() => redemptionMutation.mutate()}
            >
              {t('store.redeemButton')}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>{t('store.historyTitle')}</CardTitle>
            <CardDescription>{t('store.historyDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(grantsQuery.data?.items ?? []).map((grant) => (
              <div
                key={grant.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatSize(grant.bytes)}</span>
                    <Badge variant="outline">{grant.source}</Badge>
                    <Badge variant={grant.active ? 'default' : 'secondary'}>
                      {grant.active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{grant.orgId}</p>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(grant.createdAt).toLocaleString()}</span>
              </div>
            ))}
            {(grantsQuery.data?.items ?? []).length === 0 && (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                {t('store.noHistory')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function TargetSelect({
  targets,
  value,
  onValueChange,
}: {
  targets: QuotaTarget[]
  value: string
  onValueChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="w-full space-y-2 sm:w-72">
      <Label>{t('store.target')}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {targets.map((target) => (
            <SelectItem key={target.orgId} value={target.orgId}>
              {target.name} · {target.type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function PackageCard({
  pkg,
  disabled,
  onCheckout,
}: {
  pkg: QuotaStorePackage
  disabled: boolean
  onCheckout: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{pkg.name}</CardTitle>
            <CardDescription className="mt-1">{pkg.description}</CardDescription>
          </div>
          <HardDrive className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-2xl font-semibold">{formatSize(pkg.bytes)}</p>
          <p className="text-sm text-muted-foreground">{formatMoney(pkg.amount, pkg.currency)}</p>
        </div>
        <Button className="w-full" disabled={disabled} onClick={onCheckout}>
          <PlusCircle className="mr-2 h-4 w-4" />
          {t('store.checkout')}
        </Button>
      </CardContent>
    </Card>
  )
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`
}
