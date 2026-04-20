import { AlertCircle, Clock, Download, FileX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export type ShareErrorCode = 'not-found' | 'gone' | 'expired' | 'exhausted'

interface ShareErrorProps {
  code: ShareErrorCode
}

const config: Record<ShareErrorCode, { titleKey: string; descKey: string; Icon: typeof AlertCircle }> = {
  'not-found': { titleKey: 'share.notFound', descKey: 'share.notFoundDesc', Icon: FileX },
  gone: { titleKey: 'share.gone', descKey: 'share.goneDesc', Icon: AlertCircle },
  expired: { titleKey: 'share.expired', descKey: 'share.expiredDesc', Icon: Clock },
  exhausted: { titleKey: 'share.exhausted', descKey: 'share.exhaustedDesc', Icon: Download },
}

export function ShareError({ code }: ShareErrorProps) {
  const { t } = useTranslation()
  const { titleKey, descKey, Icon } = config[code]

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <Icon className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-2xl font-semibold">{t(titleKey)}</h1>
        <p className="text-muted-foreground">{t(descKey)}</p>
      </div>
      <Button asChild variant="outline">
        <a href="/">{t('share.browseZPan')}</a>
      </Button>
    </div>
  )
}
