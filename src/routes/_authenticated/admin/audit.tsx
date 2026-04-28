import { createFileRoute } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProBadge } from '@/components/ProBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_authenticated/admin/audit')({
  component: AuditLogsPage,
})

function AuditLogsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">{t('admin.audit.title')}</h2>
        <ProBadge tooltip={t('admin.audit.proTooltip')} />
      </div>

      <p className="text-sm text-muted-foreground">{t('admin.audit.description')}</p>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('admin.audit.placeholderTitle')}</CardTitle>
              <CardDescription>{t('admin.audit.placeholderDescription')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Audit Logs UI placeholder only. No backend events are wired yet.
        </CardContent>
      </Card>
    </div>
  )
}
