import type { ObjectListItem } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ChevronRight, Folder } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar'
import { listObjectsByPath } from '@/lib/api'
import { useActiveOrganization } from '@/lib/auth-client'

function useFolders(orgId: string | undefined, path: string, enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ['objects', 'active', 'folders', orgId, path],
    queryFn: ({ pageParam }) => listObjectsByPath(path, pageParam, 100, { type: 'folder' }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: !!orgId && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (orgId && enabled && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
  }, [enabled, orgId, query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage])

  return {
    ...query,
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
  }
}

function isAncestorOf(folderPath: string, currentPath: string): boolean {
  return currentPath === folderPath || currentPath.startsWith(`${folderPath}/`)
}

function FolderNode({
  folder,
  parentPath,
  currentPath,
  orgId,
}: {
  folder: ObjectListItem
  parentPath: string
  currentPath: string
  orgId: string
}) {
  const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
  const shouldAutoExpand = isAncestorOf(folderPath, currentPath)
  const isActive = currentPath === folderPath

  const [open, setOpen] = useState(shouldAutoExpand)
  useEffect(() => {
    if (isAncestorOf(folderPath, currentPath)) setOpen(true)
  }, [folderPath, currentPath])

  const query = useFolders(orgId, folderPath, open && folder.hasChildren)
  const subFolders = query.items

  return (
    <SidebarMenuSubItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <SidebarMenuSubButton asChild isActive={isActive}>
          <div>
            {folder.hasChildren ? (
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-label={folder.name}
                  className="group/trigger flex size-4 shrink-0 items-center justify-center"
                >
                  <ChevronRight className="size-3 transition-transform group-data-[state=open]/trigger:rotate-90" />
                </button>
              </CollapsibleTrigger>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <Link to="/files" search={{ path: folderPath }} className="flex min-w-0 flex-1 items-center gap-2">
              <Folder className="size-4 shrink-0" />
              <span className="truncate">{folder.name}</span>
            </Link>
          </div>
        </SidebarMenuSubButton>
        <CollapsibleContent>
          {subFolders.length > 0 && (
            <SidebarMenuSub className="mx-0 px-1.5">
              {subFolders.map((sub) => (
                <FolderNode key={sub.id} folder={sub} parentPath={folderPath} currentPath={currentPath} orgId={orgId} />
              ))}
            </SidebarMenuSub>
          )}
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
  )
}

export function FolderTree() {
  const { data: activeOrg } = useActiveOrganization()
  const search = useSearch({ strict: false }) as { path?: string }
  const currentPath = search.path ?? ''

  const query = useFolders(activeOrg?.id, '', true)
  const folders = query.items

  if (!activeOrg || folders.length === 0) return null

  return (
    <SidebarMenuSub className="mx-1 px-1.5">
      {folders.map((folder) => (
        <FolderNode key={folder.id} folder={folder} parentPath="" currentPath={currentPath} orgId={activeOrg.id} />
      ))}
    </SidebarMenuSub>
  )
}
