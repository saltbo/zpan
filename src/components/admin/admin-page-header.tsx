import type { ReactNode } from 'react'

interface AdminPageHeaderProps {
  title: ReactNode
  description?: ReactNode
  badge?: ReactNode
  action?: ReactNode
}

export function AdminPageHeader({ title, description, badge, action }: AdminPageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">{title}</h2>
          {badge}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
