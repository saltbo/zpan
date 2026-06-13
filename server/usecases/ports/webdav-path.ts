import type { WebDavWorkspace } from '../../domain/webdav'
import type { Matter } from './matter'

export type { WebDavWorkspace } from '../../domain/webdav'

export interface WebDavTarget {
  workspace: WebDavWorkspace | null
  mountRoot: boolean
  parent: string
  name: string
  matter: Matter | null
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
  listChildren(orgId: string, parent: string): Promise<Matter[]>
  resolveWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget>
  resolveExistingWebDavPath(userId: string, rawPath: string): Promise<WebDavTarget>
}
