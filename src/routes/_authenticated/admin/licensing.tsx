import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BoundStatusCard } from '@/components/billing/BoundStatusCard'
import { ComparisonTable } from '@/components/billing/ComparisonTable'
import { PairingModal } from '@/components/billing/PairingModal'
import { Button } from '@/components/ui/button'
import { entitlementQueryKey } from '@/hooks/useEntitlement'
import { getLicensingStatus } from '@/lib/api'

export const Route = createFileRoute('/_authenticated/admin/licensing')({
  component: LicensingPage,
})

function LicensingPage() {
  const { t } = useTranslation()
  const [pairingOpen, setPairingOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: entitlementQueryKey,
    queryFn: getLicensingStatus,
    staleTime: 60 * 1000,
  })

  if (isLoading) return null

  if (data?.bound) {
    return (
      <div className="max-w-2xl space-y-6">
        <BoundStatusCard state={data} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">{t('settings.billing.intro')}</p>

      <ComparisonTable />

      <div>
        <Button onClick={() => setPairingOpen(true)} style={{ backgroundColor: '#1A73E8' }}>
          {t('settings.billing.connectButton')}
        </Button>
      </div>

      <PairingModal open={pairingOpen} onOpenChange={setPairingOpen} />
    </div>
  )
}
