export interface OrgRepo {
  findPersonalOrg(userId: string): Promise<string | null>
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  getOrgNames(orgIds: string[]): Promise<Map<string, string>>
  canReadOrg(userId: string, orgId: string): Promise<boolean>
  canWriteToOrg(userId: string, orgId: string): Promise<boolean>
  canManageAgentAccess(userId: string, orgId: string): Promise<boolean>
  isPersonalOrg(orgId: string): Promise<boolean>
}
