import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function GlobalSearchBar() {
  const { t } = useTranslation()
  return (
    <div
      data-testid="global-search"
      className="flex h-9 max-w-[480px] flex-1 items-center gap-2 rounded-md border bg-muted/60 px-3 text-sm text-muted-foreground"
    >
      <Search className="size-4 shrink-0" />
      <span className="flex-1 truncate">{t('common.globalSearchPlaceholder')}</span>
      <kbd className="hidden rounded border bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground md:inline-block">
        ⌘K
      </kbd>
    </div>
  )
}
