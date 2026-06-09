import {
  CATEGORY_I18N,
  type CellValue,
  FEATURE_CATEGORIES,
  FEATURE_REGISTRY,
  type FeatureCategory,
} from '@shared/feature-registry'
import { Check, Clock, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function FeatureCell({
  value,
  muted,
  t,
}: {
  value: CellValue
  // Render included cells in a muted tone (used for not-yet-shipped features) so a
  // checkmark doesn't read as "available now" while still showing the target edition.
  muted?: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  if (typeof value === 'object') {
    return <span className="text-sm text-muted-foreground">{t(value.i18nKey, value.params)}</span>
  }
  return value ? (
    <Check className={muted ? 'size-4 text-muted-foreground' : 'size-4 text-primary'} aria-label="Included" />
  ) : (
    <Minus className="size-4 text-muted-foreground" aria-label="Not included" />
  )
}

export function ComparisonTable() {
  const { t } = useTranslation()

  const grouped = FEATURE_CATEGORIES.reduce(
    (acc, cat) => {
      const features = FEATURE_REGISTRY.filter((f) => f.category === cat)
      if (features.length > 0) acc.push({ category: cat, features })
      return acc
    },
    [] as { category: FeatureCategory; features: (typeof FEATURE_REGISTRY)[number][] }[],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.billing.comparison.title')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t('settings.billing.comparison.feature')}</TableHead>
              <TableHead className="w-28 text-center">{t('settings.billing.comparison.community')}</TableHead>
              <TableHead className="w-28 text-center" style={{ color: '#1A73E8' }}>
                {t('settings.billing.comparison.pro')}
              </TableHead>
              <TableHead className="w-28 text-center">{t('settings.billing.comparison.business')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped.map(({ category, features }) => (
              <>
                <TableRow key={`cat-${category}`}>
                  <TableCell
                    colSpan={4}
                    className="bg-muted/50 pl-6 font-semibold text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {t(CATEGORY_I18N[category])}
                  </TableCell>
                </TableRow>
                {features.map((feature) => {
                  const comingSoon = 'comingSoon' in feature && feature.comingSoon
                  return (
                    <TableRow key={feature.i18nKey}>
                      <TableCell className="pl-8 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {t(feature.i18nKey)}
                          {comingSoon && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                              <Clock className="size-3" />
                              {t('settings.billing.comparison.comingSoon')}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <FeatureCell value={feature.community} muted={comingSoon} t={t} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <FeatureCell value={feature.pro} muted={comingSoon} t={t} />
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <FeatureCell value={feature.business} muted={comingSoon} t={t} />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
