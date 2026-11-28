// What a deleted team left behind, read and cleared by usecases/organization-purge.ts.
// Rows that reference the organization by foreign key (members, invitations,
// image hostings, media libraries, workspace torrents) are removed by the delete
// itself; these queries cover the org-scoped rows that carry no such key.

export interface StoredObjectRef {
  storageId: string
  key: string
}

export interface DeletedOrganizationRepo {
  /** Deleted teams (a team_delete audit event and no organization row) whose space is not yet purged. */
  listPendingPurge(limit: number): Promise<string[]>
  /** The org's image-hosting objects, read before the delete cascades their rows away. */
  listImageHostingObjects(orgId: string): Promise<StoredObjectRef[]>
  listLiveDownloadTasks(orgId: string): Promise<Array<{ id: string; status: string }>>
  listActiveBackgroundJobIds(orgId: string): Promise<string[]>
  /** Removes the org's quota, quota grants, usage breakdown cache, WebDAV state and invite links. */
  deleteSpaceRows(orgId: string): Promise<void>
}
