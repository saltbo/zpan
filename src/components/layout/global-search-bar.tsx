import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function GlobalSearchBar() {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled
      data-testid="global-search"
      title={t('common.globalSearchComingSoon')}
      className="flex h-9 max-w-[480px] flex-1 items-center gap-2 rounded-md border bg-muted/60 px-3 text-left text-sm text-muted-foreground opacity-60 disabled:cursor-not-allowed"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 truncate">{t('common.globalSearchPlaceholder')}</span>
      <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground md:inline-block">
        ⌘K
      </kbd>
    </button>
  )
}
