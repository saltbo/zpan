import type { DavDeadProperty, DavLock, DavPropertyName } from '../../domain/webdav'

export type { DavDeadProperty, DavLock, DavPropertyName } from '../../domain/webdav'

export type DeadPropertyUpdate =
  | { action: 'set'; property: DavDeadProperty }
  | { action: 'remove'; property: DavPropertyName }

export interface CreateLockInput {
  orgId: string
  resourcePath: string
  owner: string
  depth: string
  timeoutSeconds: number
}

// WebDAV lock + dead-property state. Locks expire on a wall-clock TTL, so reads
// purge expired rows before returning; depth-infinity scoping is resolved in the
// repo (D1 cannot express the dynamic LIKE the scope check needs).
export interface WebDavStateRepo {
  listDeadPropertiesForResources(orgId: string, resourcePaths: string[]): Promise<Map<string, DavDeadProperty[]>>
  applyDeadPropertyUpdate(orgId: string, resourcePath: string, operations: DeadPropertyUpdate[]): Promise<void>
  copyDeadProperties(orgId: string, sourcePath: string, targetPath: string): Promise<void>
  deleteWebDavState(orgId: string, resourcePath: string): Promise<void>
  moveWebDavState(orgId: string, oldPath: string, newPath: string): Promise<void>
  activeLocks(orgId: string, resourcePath: string): Promise<DavLock[]>
  activeLocksForResources(orgId: string, resourcePaths: string[]): Promise<Map<string, DavLock[]>>
  conflictingLocks(orgId: string, resourcePath: string): Promise<DavLock[]>
  createLock(input: CreateLockInput): Promise<DavLock>
  refreshLock(orgId: string, resourcePath: string, token: string, timeoutSeconds: number): Promise<DavLock | null>
  removeLock(orgId: string, resourcePath: string, token: string): Promise<boolean>
}
