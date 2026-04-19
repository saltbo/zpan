import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const Route = createFileRoute('/_authenticated/settings/appearance')({
  component: AppearancePage,
})

function AppearancePage() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <div className="max-w-lg">
      <div className="space-y-4 rounded-md border p-4">
        <h3 className="text-sm font-medium text-muted-foreground">{t('settings.appearance.section')}</h3>

        <div className="space-y-1.5">
          <Label>{t('settings.appearance.theme')}</Label>
          <Select value={theme} onValueChange={setTheme}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t('settings.appearance.themeSystem')}</SelectItem>
              <SelectItem value="light">{t('settings.appearance.themeLight')}</SelectItem>
              <SelectItem value="dark">{t('settings.appearance.themeDark')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>{t('settings.appearance.language')}</Label>
          <Select value={i18n.resolvedLanguage} onValueChange={(lang) => i18n.changeLanguage(lang)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
