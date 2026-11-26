import { AlertCircle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

// An API error's message is written for the user on the server (UX.md, Feedback);
// anything else, such as a network failure, gets the generic hint.
export function loadErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback
}

export function LoadErrorAlert({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown
  onRetry: () => void
  retrying?: boolean
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Alert variant="destructive" className={cn('items-center', className)}>
      <AlertCircle />
      <AlertTitle>{t('common.loadError.title')}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <p>{loadErrorMessage(error, t('common.loadError.description'))}</p>
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          <RotateCw className={cn(retrying && 'animate-spin')} />
          {t('common.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
