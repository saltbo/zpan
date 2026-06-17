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

// Admin surface for storage entitlement grants (org- and user-personal-scoped),
// plus the two read checks the auth/WebDAV middleware needs. Admin user
// management (list / disable / delete) is served by better-auth's admin plugin,
// not here. Operations return UserOperationFailure instead of throwing so http
// maps {status} directly.
export interface UserAdminRepo {
  // Whether the user is banned/disabled — checked by the auth middleware on every
  // authenticated request to reject sessions of users disabled mid-session.
  isBanned(userId: string): Promise<boolean>
  // Whether `username` matches the user's email or username (WebDAV Basic Auth check).
  matchesUsername(userId: string, username: string): Promise<boolean>

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
