export interface X402CapacityPurchaseIntent {
  id: string
  orgId: string
  resourceId: string
  requestHash: string
  idempotencyKey: string
  cloudOrderId: string | null
  cloudAttemptId: string | null
  status: string
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface X402CapacityPurchaseRepo {
  get(orgId: string, resourceId: string, requestHash: string): Promise<X402CapacityPurchaseIntent | null>
  create(input: {
    orgId: string
    resourceId: string
    requestHash: string
    idempotencyKey: string
  }): Promise<X402CapacityPurchaseIntent | null>
  claimCloudOrder(id: string, staleBefore: Date): Promise<boolean>
  updateCloudState(
    id: string,
    input: {
      cloudOrderId?: string
      cloudAttemptId?: string
      status: string
      expiresAt?: Date | null
    },
  ): Promise<void>
}
