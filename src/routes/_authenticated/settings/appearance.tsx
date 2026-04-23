import { createFileRoute } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const Route = createFileRoute('/_authenticated/settings/appearance')({
  component: AppearancePage,
})

function ThemeCard() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance.theme')}</CardTitle>
        <CardDescription>{t('settings.appearance.theme.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t('settings.appearance.themeSystem')}</SelectItem>
            <SelectItem value="light">{t('settings.appearance.themeLight')}</SelectItem>
            <SelectItem value="dark">{t('settings.appearance.themeDark')}</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
      <CardFooter className="border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('settings.appearance.autoSaved')}</p>
      </CardFooter>
    </Card>
  )
}

function LanguageCard() {
  const { t, i18n } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance.language')}</CardTitle>
        <CardDescription>{t('settings.appearance.language.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={i18n.resolvedLanguage} onValueChange={(lang) => i18n.changeLanguage(lang)}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="zh">中文</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
      <CardFooter className="border-t bg-muted/30">
        <p className="text-sm text-muted-foreground">{t('settings.appearance.autoSaved')}</p>
      </CardFooter>
    </Card>
  )
}

function AppearancePage() {
  return (
    <div className="max-w-2xl space-y-6">
      <ThemeCard />
      <LanguageCard />
    </div>
  )
}
