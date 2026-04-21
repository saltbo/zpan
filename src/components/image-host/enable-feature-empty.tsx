import { Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface EnableFeatureEmptyProps {
  canEnable: boolean
  isEnabling: boolean
  onEnable: () => void
}

export function EnableFeatureEmpty({ canEnable, isEnabling, onEnable }: EnableFeatureEmptyProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-center py-20">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Image className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>{t('ihost.enableCta.title')}</CardTitle>
          <CardDescription>{t('ihost.enableCta.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {canEnable ? (
            <Button onClick={onEnable} disabled={isEnabling}>
              {isEnabling ? t('common.loading') : t('ihost.enableCta.button')}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t('ihost.enableCta.adminOnly')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
