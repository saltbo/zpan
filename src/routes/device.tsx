import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { approveDeviceCode, denyDeviceCode, useSession, verifyDeviceCode } from '@/lib/auth-client'

export const Route = createFileRoute('/device')({
  component: DeviceAuthorizationPage,
})

type DeviceStatus = 'loading' | 'pending' | 'approved' | 'denied' | 'invalid'

interface DeviceRequest {
  clientId: string
  scopes: string[]
}

export function DeviceAuthorizationPage() {
  const { t } = useTranslation()
  const session = useSession()
  const [status, setStatus] = useState<DeviceStatus>('loading')
  const [request, setRequest] = useState<DeviceRequest | null>(null)
  const userId = session.data?.user?.id
  const [loading, setLoading] = useState(false)
  const userCode = new URLSearchParams(window.location.search).get('user_code') ?? ''
  const signInRedirect = `/sign-in?redirect=${encodeURIComponent(`/device?user_code=${encodeURIComponent(userCode)}`)}`

  // biome-ignore lint/correctness/useExhaustiveDependencies: userId re-verifies after sign-in, since the requesting client and scopes are only disclosed to the owner.
  useEffect(() => {
    let canceled = false
    async function load() {
      if (!userCode) {
        setStatus('invalid')
        return
      }
      try {
        const result = await verifyDeviceCode(userCode)
        if (canceled) return
        setStatus(result.status)
        setRequest(
          result.client_id
            ? { clientId: result.client_id, scopes: result.scope?.split(' ').filter(Boolean) ?? [] }
            : null,
        )
      } catch {
        if (!canceled) setStatus('invalid')
      }
    }
    void load()
    return () => {
      canceled = true
    }
  }, [userCode, userId])

  async function approve() {
    setLoading(true)
    try {
      await approveDeviceCode(userCode)
      setStatus('approved')
      toast.success(t('device.approved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('device.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function deny() {
    setLoading(true)
    try {
      await denyDeviceCode(userCode)
      setStatus('denied')
      toast.success(t('device.denied'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('device.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <section className="w-full max-w-md rounded-md border bg-background p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{t('device.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('device.subtitle')}</p>
        </div>

        <div className="my-6 rounded-md border bg-muted/40 p-4 text-center">
          <div className="text-xs font-medium text-muted-foreground">{t('device.code')}</div>
          <div className="mt-1 font-mono text-2xl font-semibold tracking-normal">{userCode || '-'}</div>
        </div>

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {status === 'invalid' && <p className="text-sm text-destructive">{t('device.invalid')}</p>}

        {status === 'pending' && !session.data?.user && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('device.signInRequired')}</p>
            <Button asChild className="w-full">
              <Link to={signInRedirect}>{t('auth.signIn')}</Link>
            </Button>
          </div>
        )}

        {status === 'pending' && session.data?.user && (
          <div className="mb-4 space-y-3 text-sm">
            <div>
              <div className="text-xs font-medium text-muted-foreground">{t('device.requestedBy')}</div>
              <div className="mt-1 font-mono">{request?.clientId ?? '-'}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">{t('device.permissions')}</div>
              {request?.scopes.length ? (
                <ul className="mt-1 space-y-0.5 font-mono">
                  {request.scopes.map((scope) => (
                    <li key={scope}>{scope}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-muted-foreground">{t('device.noPermissions')}</div>
              )}
            </div>
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200">
              {t('device.confirmOrigin')}
            </p>
          </div>
        )}

        {status === 'pending' && session.data?.user && (
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={approve} disabled={loading || !request}>
              <Check className="size-4" />
              {t('device.approve')}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={deny} disabled={loading}>
              <X className="size-4" />
              {t('device.deny')}
            </Button>
          </div>
        )}

        {status === 'approved' && <p className="text-sm text-muted-foreground">{t('device.approvedMessage')}</p>}
        {status === 'denied' && <p className="text-sm text-muted-foreground">{t('device.deniedMessage')}</p>}
      </section>
    </main>
  )
}
