import { Link } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export type PageHeaderItem = {
  label: string
  icon?: ReactNode
  to?: string
  params?: Record<string, string>
  onClick?: () => void
}

type PageHeaderProps = {
  items: PageHeaderItem[]
  actions?: ReactNode
}

const MAX_VISIBLE = 4

type Entry = { kind: 'item'; item: PageHeaderItem } | { kind: 'ellipsis' }

function collapseItems(items: PageHeaderItem[]): Entry[] {
  if (items.length <= MAX_VISIBLE) {
    return items.map((item) => ({ kind: 'item', item }))
  }
  return [
    { kind: 'item', item: items[0] },
    { kind: 'ellipsis' },
    { kind: 'item', item: items[items.length - 2] },
    { kind: 'item', item: items[items.length - 1] },
  ]
}

function renderNavigable(item: PageHeaderItem) {
  if (item.to) {
    return (
      <BreadcrumbLink asChild>
        <Link to={item.to as never} params={item.params as never}>
          {item.label}
        </Link>
      </BreadcrumbLink>
    )
  }
  if (item.onClick) {
    return (
      <BreadcrumbLink asChild>
        <button type="button" onClick={item.onClick} className="cursor-pointer bg-transparent">
          {item.label}
        </button>
      </BreadcrumbLink>
    )
  }
  return <span className="text-muted-foreground">{item.label}</span>
}

export function PageHeader({ items, actions }: PageHeaderProps) {
  const entries = collapseItems(items)
  return (
    <div data-testid="page-header" className="flex min-h-9 flex-wrap items-center justify-between gap-3">
      <Breadcrumb>
        <BreadcrumbList className="gap-2 text-sm sm:gap-2">
          {entries.map((entry, idx) => {
            const isLast = idx === entries.length - 1
            const key = entry.kind === 'ellipsis' ? `ellipsis-${idx}` : `${idx}-${entry.item.label}`
            return (
              <Fragment key={key}>
                {idx > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="gap-2">
                  {entry.kind === 'ellipsis' ? (
                    <BreadcrumbEllipsis className="size-4" />
                  ) : (
                    <>
                      {entry.item.icon}
                      {isLast ? (
                        <BreadcrumbPage className="text-base font-semibold text-foreground">
                          {entry.item.label}
                        </BreadcrumbPage>
                      ) : (
                        renderNavigable(entry.item)
                      )}
                    </>
                  )}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
