import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ChevronRight, Folder } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar'
import { listObjectsByPath } from '@/lib/api'

function useFolders(path: string, enabled: boolean) {
  return useQuery({
    queryKey: ['folders', path],
    queryFn: () => listObjectsByPath(path, 'active', 1, 100),
    enabled,
    select: (data) => data.items.filter((item) => item.dirtype !== DirType.FILE),
  })
}

function isAncestorOf(folderPath: string, currentPath: string): boolean {
  return currentPath === folderPath || currentPath.startsWith(`${folderPath}/`)
}

function FolderNode({
  folder,
  parentPath,
  currentPath,
}: {
  folder: StorageObject
  parentPath: string
  currentPath: string
}) {
  const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
  const shouldAutoExpand = isAncestorOf(folderPath, currentPath)
  const isActive = currentPath === folderPath

  const [open, setOpen] = useState(shouldAutoExpand)
  const expanded = open || shouldAutoExpand
  // Always prefetch to know if this folder has children (for arrow visibility)
  const query = useFolders(folderPath, true)
  const subFolders = query.data ?? []
  const hasChildren = !query.isFetched || subFolders.length > 0

  return (
    <SidebarMenuSubItem>
      <Collapsible open={expanded} onOpenChange={setOpen}>
        <SidebarMenuSubButton asChild isActive={isActive}>
          <Link to="/files" search={{ path: folderPath }}>
            <CollapsibleTrigger asChild onClick={(e) => e.preventDefault()} disabled={!hasChildren}>
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform data-[state=open]:rotate-90 ${hasChildren ? '' : 'invisible'}`}
              />
            </CollapsibleTrigger>
            <Folder className="h-4 w-4" />
            <span>{folder.name}</span>
          </Link>
        </SidebarMenuSubButton>
        <CollapsibleContent>
          {subFolders.length > 0 && (
            <SidebarMenuSub className="mx-0 px-1.5">
              {subFolders.map((sub) => (
                <FolderNode key={sub.id} folder={sub} parentPath={folderPath} currentPath={currentPath} />
              ))}
            </SidebarMenuSub>
          )}
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  )
}

export function FolderTree() {
  const search = useSearch({ strict: false }) as { path?: string }
  const currentPath = search.path ?? ''

  const query = useFolders('', true)
  const folders = query.data ?? []

  if (folders.length === 0) return null

  return (
    <SidebarMenuSub className="mx-1 px-1.5">
      {folders.map((folder) => (
        <FolderNode key={folder.id} folder={folder} parentPath="" currentPath={currentPath} />
      ))}
    </SidebarMenuSub>
  )
}
