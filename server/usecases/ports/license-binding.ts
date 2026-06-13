export type LicenseBindingStatus = 'active' | 'disconnected' | 'revoked'

export interface LicenseState {
  id: string
  cloudBindingId: string
  cloudStoreId: string | null
  instanceId: string
  cloudAccountId: string
  cloudAccountEmail: string | null
  status: LicenseBindingStatus
  refreshToken: string | null
  cachedCert: string | null
  cachedExpiresAt: number | null
  boundAt: number
  disconnectedAt: number | null
  lastRefreshAt: number | null
  lastRefreshError: string | null
}

export interface CreateLicenseBindingInput {
  cloudBindingId: string
  cloudStoreId?: string | null
  instanceId: string
  cloudAccountId: string
  cloudAccountEmail?: string | null
  refreshToken: string
  cachedCert: string
  cachedExpiresAt: number
  lastRefreshAt: number
}

export interface UpdateLicenseBindingInput {
  id: string
  refreshToken: string
  cloudStoreId?: string | null
  cachedCert: string
  cachedExpiresAt: number
  cloudAccountEmail?: string | null
  lastRefreshAt: number
}

export interface LicenseBindingRepo {
  loadLicenseState(): Promise<LicenseState>
  loadActiveLicenseBinding(): Promise<LicenseState | null>
  createLicenseBinding(input: CreateLicenseBindingInput): Promise<void>
  updateLicenseBindingAfterRefresh(input: UpdateLicenseBindingInput): Promise<void>
  setLicenseRefreshError(id: string, error: string): Promise<void>
  clearLicenseBinding(status?: LicenseBindingStatus): Promise<void>
}

export interface InstanceRepo {
  getOrCreateInstanceId(): Promise<string>
  getInstanceDisplayName(): Promise<string>
}
