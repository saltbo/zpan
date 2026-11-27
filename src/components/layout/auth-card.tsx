import { DEFAULT_SITE_NAME } from '@shared/constants'
import type { ReactNode } from 'react'
import { AmbientCanvas } from '@/components/layout/ambient-canvas'
import { LanguageMenuButton } from '@/components/layout/language-menu'
import { ThemeMenuButton } from '@/components/layout/theme-menu'

interface AuthCardProps {
  /** The display wordmark. Sites pass their branded name. */
  title?: ReactNode
  /** One quiet line under the wordmark. */
  subtitle?: ReactNode
  /** The page body. A loading card has none. */
  children?: ReactNode
}

/**
 * The signed-out card every auth page shares: ambient canvas, wordmark, and the
 * language + theme controls in the top corner (logical `start-3`, so the pair
 * flips to the top-right in RTL). The triggers are icon-only glass pills; the
 * card keeps clearance (`pt-15`) so the controls sit apart from the wordmark.
 * Each page supplies its own body.
 */
export function AuthCard({ title = DEFAULT_SITE_NAME, subtitle, children }: AuthCardProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center">
      <AmbientCanvas />
      <div className="relative w-full max-w-sm space-y-6 rounded-2xl border bg-card/90 p-6 pt-15 shadow-lg backdrop-blur-md">
        <div className="absolute top-3 start-3 flex items-center gap-1">
          <LanguageMenuButton />
          <ThemeMenuButton />
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold bg-[image:var(--zpan-display-gradient)] bg-clip-text text-transparent">
            {title}
          </h1>
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}
