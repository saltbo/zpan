import { createFileRoute } from '@tanstack/react-router'
import { Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_authenticated/storages/')({
  component: StoragesPage,
})

function StoragesPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Database className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t('admin.storages.title')}</h2>
      <p className="text-sm">{t('admin.storages.placeholder')}</p>
    </div>
  )
}
