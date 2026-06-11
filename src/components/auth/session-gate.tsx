import { AlertCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export function SessionGatePending() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="space-y-3 text-center">
        <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('auth.session.loading')}</p>
      </div>
    </div>
  )
}

export function SessionGateError({ reset }: { reset: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <AlertCircle className="mx-auto size-10 text-destructive" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{t('auth.session.errorTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('auth.session.errorDescription')}</p>
        </div>
        <Button onClick={reset}>{t('auth.session.retry')}</Button>
      </div>
    </div>
  )
}
