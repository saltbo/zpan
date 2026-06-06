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

const COLLAPSE_THRESHOLD = 4

type Entry = { kind: 'item'; item: PageHeaderItem } | { kind: 'ellipsis' }

function collapseItems(items: PageHeaderItem[]): Entry[] {
  if (items.length <= COLLAPSE_THRESHOLD) {
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
      <BreadcrumbLink asChild className="block max-w-40 truncate">
        <Link to={item.to as never} params={item.params as never}>
          {item.label}
        </Link>
      </BreadcrumbLink>
    )
  }
  if (item.onClick) {
    return (
      <BreadcrumbLink asChild className="block max-w-40 truncate">
        <button type="button" onClick={item.onClick} className="cursor-pointer bg-transparent text-left">
          {item.label}
        </button>
      </BreadcrumbLink>
    )
  }
  return (
    <span className="block max-w-40 truncate text-muted-foreground" title={item.label}>
      {item.label}
    </span>
  )
}

export function PageHeader({ items, actions }: PageHeaderProps) {
  const entries = collapseItems(items)
  return (
    <div data-testid="page-header" className="flex min-h-9 min-w-0 items-center justify-between gap-3">
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="min-w-0 flex-nowrap gap-2 overflow-hidden text-sm sm:gap-2">
          {entries.map((entry, idx) => {
            const isLast = idx === entries.length - 1
            const key = entry.kind === 'ellipsis' ? `ellipsis-${idx}` : `${idx}-${entry.item.label}`
            return (
              <Fragment key={key}>
                {idx > 0 && <BreadcrumbSeparator className="shrink-0" />}
                <BreadcrumbItem className={isLast ? 'min-w-0 flex-1 gap-2' : 'min-w-0 max-w-40 shrink-0 gap-2'}>
                  {entry.kind === 'ellipsis' ? (
                    <BreadcrumbEllipsis className="size-4" />
                  ) : (
                    <>
                      {entry.item.icon ? <span className="shrink-0">{entry.item.icon}</span> : null}
                      {isLast ? (
                        <BreadcrumbPage
                          className="block min-w-0 truncate text-base font-semibold text-foreground"
                          title={entry.item.label}
                        >
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
      {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  )
}
