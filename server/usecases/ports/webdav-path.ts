import type { WebDavWorkspace } from '../../domain/webdav'

export type { WebDavWorkspace } from '../../domain/webdav'

// Transitional matter-row DTO. Mirrors the `matters` table exactly so the
// still-unmigrated matter service (copyMatter/createMatter/...) accepts values of
// this type structurally. Replace with the MatterRepo port DTO when matter
// migrates — at which point a port importing a service (the cycle source) is gone.
export interface WebDavMatterRow {
  id: string
  orgId: string
  alias: string
  name: string
  type: string
  size: number | null
  dirtype: number | null
  parent: string
  object: string
  storageId: string
  status: string
  trashedAt: number | null
  createdAt: Date
  updatedAt: Date
}

export interface WebDavTarget {
  workspace: WebDavWorkspace | null
  mountRoot: boolean
  parent: string
  name: string
  matter: WebDavMatterRow | null
}

// Thrown by the path repo when a DAV path is malformed or its workspace/matter
// cannot be resolved. Caught by lib/http-errors.ts and mapped to the carried
// status (404 not-found, 400 bad-path, 405 not-collection, 409 parent-missing).
export class WebDavPathError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export interface WebDavPathRepo {
  listUserWorkspaces(userId: string): Promise<WebDavWorkspace[]>
  listChildren(orgId: string, parent: string): Promise<WebDavMatterRow[]>
  resolveWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget>
  resolveExistingWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget>
}
