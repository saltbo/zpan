import { createFileRoute } from '@tanstack/react-router'
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_authenticated/users/')({
  component: UsersPage,
})

function UsersPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Users className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t('admin.users.title')}</h2>
      <p className="text-sm">{t('admin.users.placeholder')}</p>
    </div>
  )
}
