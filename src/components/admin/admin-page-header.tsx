import type { ReactNode } from 'react'

interface AdminPageHeaderProps {
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  badges?: ReactNode | ReactNode[]
  action?: ReactNode
  actions?: ReactNode
  filters?: ReactNode
}

export function AdminPageHeader({ title, description, badge, badges, action, actions, filters }: AdminPageHeaderProps) {
  const badgeItems = [badge, ...(Array.isArray(badges) ? badges : [badges])].filter(Boolean)
  const actionContent = actions ?? action

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-xl font-semibold">{title}</h2>
            {badgeItems.length > 0 && <div className="flex flex-wrap items-center gap-1.5">{badgeItems}</div>}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actionContent && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actionContent}</div>}
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  )
}
