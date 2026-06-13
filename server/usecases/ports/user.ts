export interface UserWithOrg {
  id: string
  name: string
  username: string
  email: string
  image: string | null
  role: string | null
  banned: boolean | null
  createdAt: Date
  orgId: string | null
  orgName: string | null
  quotaUsed: number
  quotaDefault: number
  quotaTotal: number
}

export interface QuotaEntitlementItem {
  id: string
  orgId: string
  resourceType: string
  entitlementType: string
  source: string
  sourceId: string
  bytes: number
  startsAt: Date
  expiresAt: Date | null
  status: string
  metadata: string | null
  createdAt: Date
  updatedAt: Date
}

export interface UserOperationFailure {
  error: string
  status: 400 | 404
}

export interface GrantEntitlementInput {
  adminUserId: string
  orgId: string
  resourceType: 'storage'
  bytes: number
  expiresAt?: Date | null
  note?: string | null
}

export interface UpdateEntitlementInput {
  adminUserId: string
  orgId: string
  entitlementId: string
  bytes?: number
  expiresAt?: Date | null
  note?: string | null
}

export interface EntitlementResult {
  orgId: string
  entitlement: QuotaEntitlementItem
}

// Admin surface for user management + storage entitlement grants (org- and
// user-personal-scoped). Operations return UserOperationFailure instead of
// throwing so http maps {status} directly.
export interface UserAdminRepo {
  listUsers(page: number, pageSize: number, search?: string): Promise<{ items: UserWithOrg[]; total: number }>
  getUser(userId: string): Promise<UserWithOrg | UserOperationFailure>
  setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<boolean>
  deleteUser(userId: string): Promise<boolean>
  setUsersStatus(
    userIds: string[],
    status: 'active' | 'disabled',
  ): Promise<{ updated: number; ids: string[] } | UserOperationFailure>
  deleteUsers(userIds: string[]): Promise<{ deleted: number; ids: string[] } | UserOperationFailure>

  listUserPersonalEntitlements(
    userId: string,
  ): Promise<{ orgId: string; items: QuotaEntitlementItem[] } | UserOperationFailure>
  grantUserPersonalEntitlement(input: {
    adminUserId: string
    targetUserId: string
    resourceType: 'storage'
    bytes: number
    expiresAt?: Date | null
    note?: string | null
  }): Promise<EntitlementResult | UserOperationFailure>
  updateUserPersonalEntitlement(input: {
    adminUserId: string
    targetUserId: string
    entitlementId: string
    bytes?: number
    expiresAt?: Date | null
    note?: string | null
  }): Promise<EntitlementResult | UserOperationFailure>
  revokeUserPersonalEntitlement(input: {
    adminUserId: string
    targetUserId: string
    entitlementId: string
  }): Promise<EntitlementResult | UserOperationFailure>

  requireOrg(orgId: string): Promise<{ orgId: string } | UserOperationFailure>
  listOrgEntitlements(orgId: string): Promise<{ orgId: string; items: QuotaEntitlementItem[] } | UserOperationFailure>
  grantOrgEntitlement(input: GrantEntitlementInput): Promise<EntitlementResult | UserOperationFailure>
  updateOrgEntitlement(input: UpdateEntitlementInput): Promise<EntitlementResult | UserOperationFailure>
  revokeOrgEntitlement(input: {
    adminUserId: string
    orgId: string
    entitlementId: string
  }): Promise<EntitlementResult | UserOperationFailure>
}
