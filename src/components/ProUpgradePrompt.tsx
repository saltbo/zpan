import { type LucideIcon, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface ProUpgradePromptProps {
  title: ReactNode
  description: ReactNode
  actionLabel: ReactNode
  icon?: LucideIcon
  href?: string
}

export function ProUpgradePrompt({
  title,
  description,
  actionLabel,
  icon: Icon = ShieldCheck,
  href = '/admin/licensing',
}: ProUpgradePromptProps) {
  return (
    <Card data-slot="pro-upgrade-prompt" className="border-dashed">
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="rounded-2xl border border-border/60 bg-primary/10 p-3 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild style={{ backgroundColor: '#1A73E8' }}>
          <a href={href}>{actionLabel}</a>
        </Button>
      </div>
    </Card>
  )
}
