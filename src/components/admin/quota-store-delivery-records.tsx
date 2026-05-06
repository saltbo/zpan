import type { QuotaGrant } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatSize } from '@/lib/format'

export function QuotaStoreDeliveryRecords({ grants }: { grants: QuotaGrant[] }) {
  const { t } = useTranslation()

  if (grants.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('admin.quotaStore.delivery.empty')}
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.quotaStore.delivery.source')}</TableHead>
            <TableHead>{t('admin.quotaStore.delivery.storage')}</TableHead>
            <TableHead>{t('admin.quotaStore.delivery.target')}</TableHead>
            <TableHead>{t('admin.quotaStore.delivery.terminalUser')}</TableHead>
            <TableHead>{t('admin.quotaStore.delivery.reference')}</TableHead>
            <TableHead>{t('admin.quotaStore.delivery.createdAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grants.map((grant) => (
            <TableRow key={grant.id}>
              <TableCell>
                <Badge variant="outline">{grant.source}</Badge>
              </TableCell>
              <TableCell>{formatSize(grant.bytes)}</TableCell>
              <TableCell className="font-mono text-xs">{grant.orgId}</TableCell>
              <TableCell>{grant.terminalUserEmail ?? grant.terminalUserId ?? '-'}</TableCell>
              <TableCell className="font-mono text-xs">
                {grant.cloudOrderId ?? grant.cloudRedemptionId ?? grant.externalEventId ?? '-'}
              </TableCell>
              <TableCell>{new Date(grant.createdAt).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
