import { cn } from '@/lib/utils'

interface ProBadgeProps {
  className?: string
}

export function ProBadge({ className }: ProBadgeProps) {
  return (
    <span
      data-slot="pro-badge"
      className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white', className)}
      style={{ backgroundColor: '#1A73E8' }}
    >
      Pro
    </span>
  )
}
