import { LanguageMenuButton } from '@/components/layout/language-menu'
import { ThemeMenuButton } from '@/components/layout/theme-menu'
import { cn } from '@/lib/utils'

/** Language and theme for pages that need no session, where there is no account menu to hold them. */
export function PreferenceControls({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <LanguageMenuButton compact className="h-11" />
      <ThemeMenuButton className="size-11" />
    </div>
  )
}
