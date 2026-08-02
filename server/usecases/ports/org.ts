export interface OrgRepo {
  listUserOrgs(userId: string): Promise<Array<{ id: string; name: string }>>
  findPersonalOrg(userId: string): Promise<string | null>
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  getOrgNames(orgIds: string[]): Promise<Map<string, string>>
  canReadOrg(userId: string, orgId: string): Promise<boolean>
  canWriteToOrg(userId: string, orgId: string): Promise<boolean>
  isPersonalOrg(orgId: string): Promise<boolean>
}
