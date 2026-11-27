import { type LucideIcon, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface ProUpgradePromptProps {
  title: ReactNode
  description: ReactNode
  icon?: LucideIcon
  // An action links to licensing. Without one, `note` says who can unlock the feature.
  action?: { label: ReactNode; href: string }
  note?: ReactNode
}

export function ProUpgradePrompt({
  title,
  description,
  icon: Icon = ShieldCheck,
  action,
  note,
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
        {action ? (
          <Button asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : (
          note && <p className="text-sm font-medium">{note}</p>
        )}
      </div>
    </Card>
  )
}
