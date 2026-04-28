import type { ProFeature } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { entitlementQueryKey } from '@/hooks/useEntitlement'
import type { BindingState } from '@/lib/api'
import { disconnectCloud, refreshLicense } from '@/lib/api'

const FEATURE_LABELS: Record<ProFeature, string> = {
  white_label: 'White-label branding',
  open_registration: 'Open registration',
  teams_unlimited: 'Unlimited teams',
  storages_unlimited: 'Unlimited storages',
}

function formatTimestamp(ts: number | undefined, fallback: string): string {
  if (!ts) return fallback
  return new Date(ts * 1000).toLocaleString()
}

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

  const planLabel =
    state.plan === 'pro' ? t('settings.billing.bound.planPro') : t('settings.billing.bound.planCommunity')
  const never = t('settings.billing.bound.never')

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.billing.bound.cloudAccount')}</CardTitle>
          <CardDescription>{state.account_email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <span className="text-muted-foreground">{t('settings.billing.bound.plan')}</span>
            <span className="font-medium">{planLabel}</span>

            <span className="text-muted-foreground">{t('settings.billing.bound.expiresAt')}</span>
            <span>{formatTimestamp(state.expires_at, never)}</span>

            <span className="text-muted-foreground">{t('settings.billing.bound.lastRefresh')}</span>
            <span>{formatTimestamp(state.last_refresh_at, never)}</span>

            {state.last_refresh_error && (
              <>
                <span className="text-muted-foreground">{t('settings.billing.bound.lastRefreshError')}</span>
                <span className="text-destructive text-xs">{state.last_refresh_error}</span>
              </>
            )}
          </div>

          {state.features && state.features.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">{t('settings.billing.bound.features')}</p>
              <ul className="space-y-1">
                {state.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <span className="size-1.5 rounded-full bg-primary" />
                    {FEATURE_LABELS[f] ?? f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2 border-t bg-muted/30">
          <Button asChild>
            <a href="https://cloud.zpan.space/dashboard" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 size-4" />
              {t('settings.billing.bound.manageButton')}
            </a>
          </Button>
          <Button variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
            {refreshMutation.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('settings.billing.bound.refreshing')}
              </>
            ) : (
              t('settings.billing.bound.refreshButton')
            )}
          </Button>
          <div className="ml-auto">
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              {t('settings.billing.bound.disconnectButton')}
            </Button>
          </div>
        </CardFooter>
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
