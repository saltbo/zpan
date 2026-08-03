export interface UserWorkspaceCatalogItem {
  id: string
  name: string
  type: 'personal' | 'organization'
  role: string
}

export interface OrgRepo {
  listUserOrgs(userId: string): Promise<Array<{ id: string; name: string }>>
  listUserWorkspaceCatalog(userId: string): Promise<UserWorkspaceCatalogItem[]>
  findPersonalOrg(userId: string): Promise<string | null>
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  getOrgNames(orgIds: string[]): Promise<Map<string, string>>
  canReadOrg(userId: string, orgId: string): Promise<boolean>
  canWriteToOrg(userId: string, orgId: string): Promise<boolean>
  isPersonalOrg(orgId: string): Promise<boolean>
}
