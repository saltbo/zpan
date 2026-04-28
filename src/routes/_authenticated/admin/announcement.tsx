import { createFileRoute } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProBadge } from '@/components/ProBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_authenticated/admin/announcement')({
  component: AnnouncementPage,
})

function AnnouncementPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">{t('admin.announcement.title')}</h2>
        <ProBadge />
      </div>

      <p className="text-sm text-muted-foreground">{t('admin.announcement.description')}</p>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/60 bg-primary/10 p-2 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>{t('admin.announcement.placeholderTitle')}</CardTitle>
              <CardDescription>{t('admin.announcement.placeholderDescription')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Site Announcement UI placeholder only. No publishing workflow is wired yet.
        </CardContent>
      </Card>
    </div>
  )
}
