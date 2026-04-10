import { Fragment } from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import type { BreadcrumbItem as BreadcrumbEntry } from './types'

interface FilesBreadcrumbProps {
  trail: BreadcrumbEntry[]
  onNavigate: (folderId: string) => void
}

export function FilesBreadcrumb({ trail, onNavigate }: FilesBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((item, index) => (
          <Fragment key={item.id || 'root'}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {index === trail.length - 1 ? (
                <BreadcrumbPage>{item.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink className="cursor-pointer" onClick={() => onNavigate(item.id)}>
                  {item.name}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
