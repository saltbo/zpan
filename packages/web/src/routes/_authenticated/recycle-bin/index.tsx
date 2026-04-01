import { createFileRoute } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_authenticated/recycle-bin/')({
  component: RecycleBinPage,
})

function RecycleBinPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Trash2 className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t('recycleBin.title')}</h2>
      <p className="text-sm">{t('recycleBin.placeholder')}</p>
    </div>
  )
}
