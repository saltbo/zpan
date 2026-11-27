import { ChevronDown, Palette } from 'lucide-react'
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

type ThemeValue = 'system' | 'light' | 'dark'

/** The label keys for each setting. `next-themes` reports a free-form string. */
const THEME_LABEL_KEY: Record<ThemeValue, string> = {
  system: 'settings.appearance.themeSystem',
  light: 'settings.appearance.themeLight',
  dark: 'settings.appearance.themeDark',
}

/** The shared theme choices. Switching caches to localStorage, so it survives reloads. */
function ThemeRadioGroup() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuRadioGroup value={themeValue(theme)} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="system">{t(THEME_LABEL_KEY.system)}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="light">{t(THEME_LABEL_KEY.light)}</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">{t(THEME_LABEL_KEY.dark)}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )
}

function themeValue(theme?: string): ThemeValue {
  return theme === 'light' || theme === 'dark' ? theme : 'system'
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

/** Standalone button for pages with no surrounding menu, e.g. the sign-in page.
 *  Same icon as ThemeMenuSub and the same setting label as the checked choice, so
 *  the login control is the same object the signed-in menu shows. */
export function ThemeMenuButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const value = themeValue(theme)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${t('settings.appearance.theme')}: ${t(THEME_LABEL_KEY[value])}`}
          className={className}
        >
          <Palette className="size-4" />
          {t(THEME_LABEL_KEY[value])}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
