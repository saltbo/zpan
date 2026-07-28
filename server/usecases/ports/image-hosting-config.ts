export interface ImageHostingConfigRecord {
  orgId: string
  customDomain: string | null
  domainProvider: 'cloudflare_saas' | 'manual' | null
  providerHostnameId: string | null
  domainStatus: 'pending_dns' | 'pending_tls' | 'verified' | 'failed' | null
  domainError: string | null
  verificationToken: string | null
  domainLastCheckedAt: Date | null
  domainVerifiedAt: Date | null
  refererAllowlist: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateImageHostingConfigInput {
  orgId: string
  customDomain: string | null
  domainProvider: ImageHostingConfigRecord['domainProvider']
  providerHostnameId: string | null
  domainStatus: ImageHostingConfigRecord['domainStatus']
  domainError: string | null
  verificationToken: string | null
  refererAllowlist: string | null
}

export interface UpdateImageHostingConfigInput {
  customDomain?: string | null
  domainProvider?: ImageHostingConfigRecord['domainProvider']
  providerHostnameId?: string | null
  domainStatus?: ImageHostingConfigRecord['domainStatus']
  domainError?: string | null
  verificationToken?: string | null
  domainLastCheckedAt?: Date | null
  domainVerifiedAt?: Date | null
  refererAllowlist?: string | null
}

export interface ImageHostingConfigRepo {
  getByOrg(orgId: string): Promise<ImageHostingConfigRecord | null>
  getByDomain(domain: string): Promise<ImageHostingConfigRecord | null>
  listWithDomains(): Promise<ImageHostingConfigRecord[]>
  create(input: CreateImageHostingConfigInput): Promise<void>
  update(orgId: string, set: UpdateImageHostingConfigInput): Promise<void>
  markAllDomainsPending(
    provider: Exclude<ImageHostingConfigRecord['domainProvider'], null>,
    preserveExternalIds: boolean,
  ): Promise<void>
  delete(orgId: string): Promise<void>
}
