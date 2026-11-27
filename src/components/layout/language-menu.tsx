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
import { cn } from '@/lib/utils'

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
 *  The trigger is icon-only glass (h-7, size-3.5): quiet in the card corner. The
 *  word "Language" and the language's own name (endonym) ride in the accessible
 *  name, so screen readers, tests, and the e2e gate still get the full statement. */
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
          className={cn('h-7', className)}
        >
          <Languages className="size-3.5" />
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <LanguageRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
