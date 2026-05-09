import { Gift, HardDrive, ShoppingCart } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'

export function StorageUnavailableState({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{t('storage.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {disabled ? t('storage.disabledSubtitle') : t('storage.unavailable')}
        </p>
      </div>

      <Card className="border-border/60">
        <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_1.25fr] md:items-center">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
              <HardDrive className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-medium">
                {disabled ? t('storage.disabledTitle') : t('storage.unavailableTitle')}
              </h3>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                {disabled ? t('storage.disabledDescription') : t('storage.unavailableDescription')}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <UnavailablePoint icon={<ShoppingCart />} label={t('storage.disabledBuying')} />
            <UnavailablePoint icon={<Gift />} label={t('storage.disabledRedeeming')} />
            <UnavailablePoint icon={<HardDrive />} label={t('storage.disabledExistingStorage')} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function UnavailablePoint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-background px-4 py-3 text-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span>{label}</span>
    </div>
  )
}
