export interface EffectiveQuota {
  orgId: string
  baseQuota: number
  entitlementQuota: number
  quota: number
  used: number
  baseTrafficQuota: number
  entitlementTrafficQuota: number
  trafficQuota: number
  trafficUsed: number
  trafficPeriod: string
  storagePlanName: string | null
  storageExtraNames: string[]
  trafficPlanName: string | null
  trafficExtraNames: string[]
  currentPlan: CurrentStoragePlan | null
}

export interface CurrentStoragePlan {
  sourceId: string
  packageId: string | null
  name: string
  storageBytes: number
  trafficBytes: number
  trafficOveragePriceCents: number | null
  expiresAt: string | null
  subscription: boolean
}

export interface OrgQuotaOverviewRow {
  id: string
  orgId: string
  orgName: string
  orgMetadata: string | null
}

export interface QuotaRepo {
  listOrgQuotaOverview(): Promise<OrgQuotaOverviewRow[]>
  getEffectiveQuota(orgId: string, now?: Date): Promise<EffectiveQuota>
  getEffectiveQuotasByOrg(orgIds: string[], now?: Date): Promise<Map<string, EffectiveQuota>>
  resetExpiredTrafficQuotas(now?: Date): Promise<void>
  hasQuotaForBytes(orgId: string, bytes: number): Promise<boolean>
  hasTrafficQuotaForBytes(orgId: string, bytes: number, now?: Date): Promise<boolean>
  consumeTrafficIfQuotaAllows(orgId: string, bytes: number, now?: Date): Promise<boolean>
  refundTraffic(orgId: string, bytes: number, now?: Date): Promise<void>
  incrementUsageIfEffectiveQuotaAllows(
    orgId: string,
    storageId: string,
    bytes: number,
    teamQuotaEnabled?: boolean,
    now?: Date,
  ): Promise<boolean>
}
