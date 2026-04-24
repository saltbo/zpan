import { Check, Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface FeatureRow {
  label: string
  community: boolean | string
  pro: boolean | string
}

function FeatureCell({ value }: { value: boolean | string }) {
  if (typeof value === 'string') {
    return <span className="text-sm text-muted-foreground">{value}</span>
  }
  return value ? (
    <Check className="size-4 text-primary" aria-label="Included" />
  ) : (
    <Minus className="size-4 text-muted-foreground" aria-label="Not included" />
  )
}

export function ComparisonTable() {
  const { t } = useTranslation()

  const rows: FeatureRow[] = [
    {
      label: t('settings.billing.comparison.coreFeatures'),
      community: true,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.singleIdp'),
      community: true,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.inviteCodes'),
      community: true,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.allDeployments'),
      community: true,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.upTo3Teams'),
      community: true,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.teamsUnlimited'),
      community: false,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.openRegistration'),
      community: false,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.teamQuotas'),
      community: false,
      pro: true,
    },
    {
      label: t('settings.billing.comparison.whiteLabel'),
      community: false,
      pro: true,
    },
  ]

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
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="pl-6 font-medium">{row.label}</TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <FeatureCell value={row.community} />
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <FeatureCell value={row.pro} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
