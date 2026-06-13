import type { CloudOrderQuotaChange } from '@shared/schemas'
import type { CloudStoreTarget } from '@shared/types'

export interface CloudStoreBinding {
  boundLicenseId: string
  storeId: string
  refreshToken: string
  instanceId: string
}

export interface CloudStoreRepo {
  getAccessibleTargets(userId: string): Promise<CloudStoreTarget[]>
  // Throws Error('quota_store_binding_missing') when no bound store exists.
  getCloudStoreBinding(): Promise<CloudStoreBinding>
  getCustomerLabel(userId: string, orgId: string): Promise<string | null>
  processCloudOrderQuotaChange(
    event: CloudOrderQuotaChange,
    rawPayload: string,
    payloadHash: string,
  ): Promise<{ duplicate: boolean; eventId: string }>
}
