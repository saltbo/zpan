import { ChevronDown, Languages } from 'lucide-react'
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
import { LANGUAGE_OPTIONS, languageCode, languageLabel } from '@/i18n/languages'

/** The shared language choices. Switching caches to localStorage, so it survives reloads. */
function LanguageRadioGroup() {
  const { i18n } = useTranslation()
  return (
    <DropdownMenuRadioGroup
      value={languageCode(i18n.resolvedLanguage)}
      onValueChange={(lang) => i18n.changeLanguage(lang)}
    >
      {LANGUAGE_OPTIONS.map(({ code, label }) => (
        <DropdownMenuRadioItem key={code} value={code}>
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** Submenu form, for use inside an existing dropdown menu such as the account menu. */
export function LanguageMenuSub() {
  const { t } = useTranslation()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Languages className="mr-2 h-4 w-4" />
        <span>{t('settings.appearance.language')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <LanguageRadioGroup />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Standalone button for pages with no surrounding menu, e.g. the sign-in page.
 *  The trigger shows the icon and the language's own name (endonym), which reads
 *  correctly in every locale and needs no translation. The word "Language" lives
 *  in the accessible name only, so screen readers and the e2e gate still get it. */
export function LanguageMenuButton({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const label = languageLabel(i18n.resolvedLanguage)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${t('settings.appearance.language')}: ${label}`}
          className={className}
        >
          <Languages className="size-4" />
          {label}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <LanguageRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
