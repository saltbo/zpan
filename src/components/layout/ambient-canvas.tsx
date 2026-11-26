import { cn } from '@/lib/utils'

// Decorative atmosphere (blueprint grid + spotlight halo) for the auth pages
// and the public header band. Colors derive from --zpan-theme-ring via
// color-mix so the atmosphere follows each site's branding; the layer is
// static (no motion), aria-hidden, and never intercepts pointer events.

const GRID_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(0deg, color-mix(in oklab, var(--zpan-theme-ring) 9%, transparent) 0 1px, transparent 1px 80px), ' +
    'repeating-linear-gradient(90deg, color-mix(in oklab, var(--zpan-theme-ring) 9%, transparent) 0 1px, transparent 1px 80px)',
} as const

const PAGE_GRID_STYLE = {
  ...GRID_STYLE,
  maskImage: 'radial-gradient(ellipse 100% 80% at 50% 35%, black 40%, transparent 100%)',
  WebkitMaskImage: 'radial-gradient(ellipse 100% 80% at 50% 35%, black 40%, transparent 100%)',
} as const

const SPOTLIGHT_STYLE = {
  backgroundImage:
    'conic-gradient(from 90deg at 50% -15%, transparent 0deg 150deg, ' +
    'color-mix(in oklab, var(--zpan-theme-ring) 14%, transparent) 180deg, transparent 210deg 360deg)',
} as const

interface AmbientCanvasProps {
  /** 'page' fills the viewport with grid + spotlight (auth pages); 'band' is the grid only (header). */
  variant?: 'page' | 'band'
  className?: string
}

export function AmbientCanvas({ variant = 'page', className }: AmbientCanvasProps) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden opacity-45 dark:opacity-100', className)}
    >
      <div className="absolute inset-0" style={variant === 'page' ? PAGE_GRID_STYLE : GRID_STYLE} />
      {variant === 'page' && <div className="absolute inset-0" style={SPOTLIGHT_STYLE} />}
    </div>
  )
}
