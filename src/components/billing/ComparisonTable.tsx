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
  comingSoon,
  t,
}: {
  value: CellValue
  comingSoon?: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  if (comingSoon) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" />
        {t('settings.billing.comparison.comingSoon')}
      </span>
    )
  }
  if (typeof value === 'object') {
    return <span className="text-sm text-muted-foreground">{t(value.i18nKey, value.params)}</span>
  }
  return value ? (
    <Check className="size-4 text-primary" aria-label="Included" />
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped.map(({ category, features }) => (
              <>
                <TableRow key={`cat-${category}`}>
                  <TableCell
                    colSpan={3}
                    className="bg-muted/50 pl-6 font-semibold text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    {t(CATEGORY_I18N[category])}
                  </TableCell>
                </TableRow>
                {features.map((feature) => (
                  <TableRow key={feature.i18nKey}>
                    <TableCell className="pl-8 font-medium">{t(feature.i18nKey)}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <FeatureCell value={feature.community} t={t} />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <FeatureCell
                          value={feature.pro}
                          comingSoon={'comingSoon' in feature && feature.comingSoon}
                          t={t}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
