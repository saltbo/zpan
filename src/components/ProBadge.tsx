import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface ProBadgeProps {
  className?: string
  tooltip?: string
}

function ProBadgePill({ className }: { className?: string }) {
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

export function ProBadge({ className, tooltip }: ProBadgeProps) {
  if (!tooltip) return <ProBadgePill className={className} />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex cursor-help appearance-none bg-transparent p-0">
          <ProBadgePill className={className} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
