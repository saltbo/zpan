export interface ImageHostingConfigRecord {
  orgId: string
  customDomain: string | null
  cfHostnameId: string | null
  domainVerifiedAt: Date | null
  refererAllowlist: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateImageHostingConfigInput {
  orgId: string
  customDomain: string | null
  cfHostnameId: string | null
  refererAllowlist: string | null
}

export interface UpdateImageHostingConfigInput {
  customDomain?: string | null
  cfHostnameId?: string | null
  domainVerifiedAt?: Date | null
  refererAllowlist?: string | null
}

export interface ImageHostingConfigRepo {
  getByOrg(orgId: string): Promise<ImageHostingConfigRecord | null>
  create(input: CreateImageHostingConfigInput): Promise<void>
  update(orgId: string, set: UpdateImageHostingConfigInput): Promise<void>
  delete(orgId: string): Promise<void>
}
