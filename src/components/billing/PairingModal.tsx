import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { entitlementQueryKey } from '@/hooks/useEntitlement'
import type { PairingInfo } from '@/lib/api'
import { connectCloud, pollPairing } from '@/lib/api'

type PairingState = 'loading' | 'waiting' | 'denied' | 'expired' | 'error'

interface PairingModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState<number>(0)

  useEffect(() => {
    if (!expiresAt) return
    const target = new Date(expiresAt).getTime()
    function tick() {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000))
      setRemaining(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  return { remaining, display: `${minutes}:${String(seconds).padStart(2, '0')}` }
}

export function PairingModal({ open, onOpenChange }: PairingModalProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [state, setState] = useState<PairingState>('loading')
  const [pairingInfo, setPairingInfo] = useState<PairingInfo | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdown = useCountdown(pairingInfo?.expires_at ?? null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  // Auto-expire when countdown reaches 0
  useEffect(() => {
    if (countdown.remaining === 0 && state === 'waiting') {
      setState('expired')
      stopPolling()
    }
  }, [countdown.remaining, state, stopPolling])

  const beginPolling = useCallback(
    (code: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const result = await pollPairing(code)
          if (result.status === 'pending') return
          stopPolling()
          if (result.status === 'approved') {
            await queryClient.invalidateQueries({ queryKey: entitlementQueryKey })
            const status = queryClient.getQueryData<{ account_email?: string }>(entitlementQueryKey)
            const email = status?.account_email ?? ''
            toast.success(t('settings.billing.pairing.connected', { email }))
            onOpenChange(false)
          } else if (result.status === 'denied') {
            setState('denied')
          } else {
            setState('expired')
          }
        } catch {
          stopPolling()
          setState('error')
        }
      }, 5000)
    },
    [stopPolling, queryClient, t, onOpenChange],
  )

  const startPairing = useCallback(async () => {
    setState('loading')
    setPairingInfo(null)
    try {
      const info = await connectCloud()
      setPairingInfo(info)
      setState('waiting')
      beginPolling(info.code)
    } catch {
      setState('error')
    }
  }, [beginPolling])

  useEffect(() => {
    if (open) {
      startPairing()
    } else {
      stopPolling()
      setState('loading')
      setPairingInfo(null)
    }
    return stopPolling
  }, [open, startPairing, stopPolling])

  function handleCancel() {
    stopPolling()
    onOpenChange(false)
  }

  const isTerminal = state === 'denied' || state === 'expired' || state === 'error'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.billing.pairing.title')}</DialogTitle>
          <DialogDescription>{t('settings.billing.pairing.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {state === 'loading' && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {(state === 'waiting' || isTerminal) && pairingInfo && (
            <div className="space-y-4">
              {/* QR Code */}
              <div className="flex justify-center">
                <div className="rounded-lg border p-3">
                  <QRCodeSVG value={pairingInfo.pairing_url} size={160} />
                </div>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                {t('settings.billing.pairing.step1')}{' '}
                <a
                  href={pairingInfo.pairing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-4"
                >
                  cloud.zpan.space/pair
                </a>
              </p>

              {/* Code display */}
              <div className="text-center">
                <span className="rounded bg-muted px-3 py-1.5 font-mono text-lg font-bold tracking-widest">
                  {pairingInfo.code}
                </span>
              </div>
            </div>
          )}

          {state === 'waiting' && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" />
                {t('settings.billing.pairing.waiting')}
              </span>
              <span className="tabular-nums">{countdown.display}</span>
            </div>
          )}

          {state === 'denied' && <p className="text-sm text-destructive">{t('settings.billing.pairing.denied')}</p>}

          {(state === 'expired' || state === 'error') && (
            <p className="text-sm text-destructive">{t('settings.billing.pairing.expired')}</p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {pairingInfo && (
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <a href={pairingInfo.pairing_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 size-4" />
                {t('settings.billing.pairing.openDashboard')}
              </a>
            </Button>
          )}
          {isTerminal && (
            <Button onClick={startPairing} className="w-full sm:w-auto">
              {t('settings.billing.pairing.retry')}
            </Button>
          )}
          <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto">
            {t('settings.billing.pairing.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
