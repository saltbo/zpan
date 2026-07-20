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
  pathSegment: string
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

export function encodeDavPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function matterHref(
  workspace: WebDavWorkspace,
  matter: Pick<WebDavMatter, 'parent' | 'name'>,
  mountPath: '' | '/dav',
): string {
  const path = joinMatterPath(matter.parent, matter.name)
  return `${workspaceHref(workspace, mountPath)}${path.split('/').map(encodeDavPathSegment).join('/')}`
}

export function workspaceHref(workspace: WebDavWorkspace, mountPath: '' | '/dav'): string {
  return `${mountPath}/${encodeDavPathSegment(workspace.pathSegment)}/`
}

export function davEtag(id: string, size: number, updatedAt: Date): string {
  return `"${id}-${size}-${updatedAt.getTime()}"`
}
