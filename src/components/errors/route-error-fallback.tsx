import { type ErrorComponentProps, useRouter } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { loadErrorMessage } from './load-error-alert'

export function RouteErrorFallback({ error }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-4 text-center">
        <AlertCircle className="mx-auto size-10 text-destructive" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">{t('common.routeError.title')}</h2>
          <p className="text-sm text-muted-foreground">{loadErrorMessage(error, t('common.routeError.description'))}</p>
        </div>
        {/* invalidate re-runs the route's loaders and resets its error boundary; reset() alone does not reload. */}
        <Button onClick={() => router.invalidate()}>{t('common.retry')}</Button>
      </div>
    </div>
  )
}
