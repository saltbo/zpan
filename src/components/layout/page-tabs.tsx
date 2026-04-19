import { Link, useRouterState } from '@tanstack/react-router'

export type PageTabItem = {
  to: string
  params?: Record<string, string>
  label: string
}

type PageTabsProps = {
  items: PageTabItem[]
}

function resolveHref(to: string, params?: Record<string, string>): string {
  if (!params) return to
  return Object.entries(params).reduce((href, [key, value]) => href.replace(`$${key}`, value), to)
}

function tabClass(isActive: boolean): string {
  return isActive
    ? 'border-b-2 border-primary -mb-px px-4 py-2 text-sm font-medium text-foreground'
    : 'border-b-2 border-transparent -mb-px px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
}

export function PageTabs({ items }: PageTabsProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <nav className="flex gap-1" aria-label="Page navigation">
      {items.map((item) => {
        const resolved = resolveHref(item.to, item.params)
        return (
          <Link key={item.to} to={item.to} params={item.params} className={tabClass(pathname === resolved)}>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
