import type { ProFeature } from '@shared/types'
import { useEntitlement } from '@/hooks/useEntitlement'
import { Button } from './ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'

const FEATURE_LABELS: Record<ProFeature, string> = {
  white_label: 'white-label branding',
  open_registration: 'open registration',
  teams_unlimited: 'unlimited teams',
  storages_unlimited: 'unlimited storages',
  audit_log: 'audit logs',
}

interface UpgradeHintProps {
  feature: ProFeature
}

export function UpgradeHint({ feature }: UpgradeHintProps) {
  const { bound } = useEntitlement()
  const featureLabel = FEATURE_LABELS[feature] ?? feature

  return (
    <Card data-slot="upgrade-hint">
      <CardHeader>
        <CardTitle>Unlock with ZPan Pro</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {featureLabel.charAt(0).toUpperCase() + featureLabel.slice(1)} is a Pro feature. Upgrade your plan to access
          it.
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild>
          <a href="/admin/billing">{bound ? 'Manage on Cloud' : 'Connect to Cloud'}</a>
        </Button>
      </CardFooter>
    </Card>
  )
}
