import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'settings.appearance.themeSystem', Icon: Monitor },
  { value: 'light', labelKey: 'settings.appearance.themeLight', Icon: Sun },
  { value: 'dark', labelKey: 'settings.appearance.themeDark', Icon: Moon },
] as const

function currentTheme(theme: string | undefined) {
  return THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0]
}

/** The shared theme choices: system, light, and dark. */
function ThemeRadioGroup() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuRadioGroup value={currentTheme(theme).value} onValueChange={setTheme}>
      {THEME_OPTIONS.map(({ value, labelKey, Icon }) => (
        <DropdownMenuRadioItem key={value} value={value}>
          <Icon className="size-4" />
          {t(labelKey)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** Submenu form, for use inside an existing dropdown menu such as the account menu. */
export function ThemeMenuSub() {
  const { t } = useTranslation()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="mr-2 h-4 w-4" />
        <span>{t('settings.appearance.theme')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeRadioGroup />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Icon button for pages with no surrounding menu; its icon shows the current choice. */
export function ThemeMenuButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { labelKey, Icon } = currentTheme(theme)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          aria-label={`${t('settings.appearance.theme')}: ${t(labelKey)}`}
        >
          <Icon className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
