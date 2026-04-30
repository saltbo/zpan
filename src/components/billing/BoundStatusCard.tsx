import { FEATURE_REGISTRY } from '@shared/feature-registry'
import type { ProFeature } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unlink,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { entitlementQueryKey } from '@/hooks/useEntitlement'
import type { BindingState } from '@/lib/api'
import { disconnectCloud, refreshLicense } from '@/lib/api'

function featureLabelKey(feature: ProFeature): string | null {
  return FEATURE_REGISTRY.find((item) => 'gateKey' in item && item.gateKey === feature)?.i18nKey ?? null
}

function humanizeFeature(feature: string): string {
  return feature
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const LOCAL_PRO_FEATURES = FEATURE_REGISTRY.filter(
  (item): item is (typeof FEATURE_REGISTRY)[number] & { gateKey: ProFeature } =>
    'gateKey' in item && item.gateKey != null && !('comingSoon' in item && item.comingSoon),
).map((item) => item.gateKey)

interface BoundStatusCardProps {
  state: BindingState
}

export function BoundStatusCard({ state }: BoundStatusCardProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const refreshMutation = useMutation({
    mutationFn: refreshLicense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entitlementQueryKey })
      toast.success(t('settings.billing.bound.refreshSuccess'))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('settings.billing.bound.refreshError')),
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectCloud,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: entitlementQueryKey })
      setDisconnectOpen(false)
      toast.success(t('settings.billing.bound.disconnectSuccess'))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('settings.billing.bound.disconnectError')),
  })

  const grantedFeatures = state.active ? LOCAL_PRO_FEATURES : []
  const hasSyncError = Boolean(state.last_refresh_error)
  const issuedLabel = state.account_email
    ? t('settings.billing.bound.issuedTo', { email: state.account_email })
    : t('settings.billing.bound.issuedByCloud')

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/20 px-6 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-md border bg-background text-primary">
                <ShieldCheck className="size-5" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl">{t('settings.billing.bound.title')}</CardTitle>
                  <span
                    className={
                      hasSyncError
                        ? 'inline-flex w-fit items-center gap-1.5 rounded-full border border-destructive/30 bg-background px-2.5 py-1 text-xs font-medium text-destructive'
                        : 'inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/30 bg-background px-2.5 py-1 text-xs font-medium text-primary'
                    }
                  >
                    {hasSyncError ? <TriangleAlert className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                    {hasSyncError ? t('settings.billing.bound.syncIssue') : t('settings.billing.bound.active')}
                  </span>
                </div>
                <CardDescription className="break-words">{issuedLabel}</CardDescription>
                <p className="text-sm text-muted-foreground">{t('settings.billing.bound.description')}</p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button asChild>
                <a href="https://cloud.zpan.space/dashboard" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 size-4" />
                  {t('settings.billing.bound.manageButton')}
                </a>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('settings.billing.bound.actionsMenu')}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
                    {refreshMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {refreshMutation.isPending
                      ? t('settings.billing.bound.refreshing')
                      : t('settings.billing.bound.refreshButton')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDisconnectOpen(true)}>
                    <Unlink className="size-4" />
                    {t('settings.billing.bound.disconnectButton')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 px-6 pb-6 pt-1">
          {state.last_refresh_error && (
            <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{t('settings.billing.bound.lastRefreshError')}</p>
                <p className="break-words text-xs">{state.last_refresh_error}</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-medium">{t('settings.billing.bound.features')}</p>
            {grantedFeatures.length > 0 ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {grantedFeatures.map((feature) => {
                  const labelKey = featureLabelKey(feature)
                  return (
                    <li
                      key={feature}
                      className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm"
                    >
                      <CheckCircle2 className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0">{labelKey ? t(labelKey) : humanizeFeature(feature)}</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('settings.billing.bound.noFeatures')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.billing.bound.disconnectTitle')}</DialogTitle>
            <DialogDescription>{t('settings.billing.bound.disconnectConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? t('common.loading') : t('settings.billing.bound.disconnectButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
