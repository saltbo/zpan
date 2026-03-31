import { ChevronRight, Home } from 'lucide-react'
import { typeLabelFromParam } from '../utils'

interface BreadcrumbItem {
  id: string
  name: string
}

interface BreadcrumbNavProps {
  path: BreadcrumbItem[]
  typeFilter: string | undefined
  onNavigate: (folderId: string) => void
}

export function BreadcrumbNav({ path, typeFilter, onNavigate }: BreadcrumbNavProps) {
  const typeLabel = typeLabelFromParam(typeFilter)

  if (typeLabel) {
    return (
      <nav className="flex items-center gap-1 text-sm">
        <span className="font-medium">{typeLabel}</span>
      </nav>
    )
  }

  return (
    <nav className="flex items-center gap-1 text-sm">
      <button
        onClick={() => onNavigate('')}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
        <span>My Files</span>
      </button>
      {path.map((item) => (
        <span key={item.id} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <button
            onClick={() => onNavigate(item.id)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {item.name}
          </button>
        </span>
      ))}
    </nav>
  )
}
