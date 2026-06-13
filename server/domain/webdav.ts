export const DAV_NAMESPACE = 'DAV:'

export interface DavPropertyName {
  namespace: string
  name: string
}

export interface DavDeadProperty extends DavPropertyName {
  value: string
}

export interface DavLock {
  id: string
  token: string
  orgId: string
  resourcePath: string
  owner: string
  depth: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface WebDavWorkspace {
  id: string
  name: string
  slug: string
  href: string
}

// The matter fields the WebDAV href/etag/entry helpers read. A full matter row
// is structurally assignable, so http handlers pass their rows directly.
export interface WebDavMatter {
  id: string
  name: string
  parent: string
  type: string
  size: number | null
  dirtype: number | null
  createdAt: Date
  updatedAt: Date
}

export function joinMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function matterHref(workspace: WebDavWorkspace, matter: Pick<WebDavMatter, 'parent' | 'name'>): string {
  const path = joinMatterPath(matter.parent, matter.name)
  return `/dav/${encodeURIComponent(workspace.slug)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function workspaceHref(workspace: WebDavWorkspace): string {
  return `/dav/${encodeURIComponent(workspace.slug)}/`
}

export function davEtag(id: string, size: number, updatedAt: Date): string {
  return `"${id}-${size}-${updatedAt.getTime()}"`
}
