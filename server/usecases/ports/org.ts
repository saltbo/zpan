export interface OrgRepo {
  findPersonalOrg(userId: string): Promise<string | null>
  getMemberRole(orgId: string, userId: string): Promise<string | null>
  canReadOrg(userId: string, orgId: string): Promise<boolean>
  canWriteToOrg(userId: string, orgId: string): Promise<boolean>
  isPersonalOrg(orgId: string): Promise<boolean>
}
