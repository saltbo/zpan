import type { z } from 'zod'
import type { CloudClient } from 'zpan-cloud-sdk'

export interface PairingResponse {
  code: string
  pairingUrl: string
  expiresAt: string
}

export interface PairingPollResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  refreshToken?: string
  certificate?: string
  binding?: LicenseBindingInfo
  account?: LicenseAccountInfo
}

export interface EntitlementRefreshResponse {
  refreshToken: string
  certificate: string
  binding: LicenseBindingInfo
  account: LicenseAccountInfo
  nextRefreshAfter?: string
}

export interface LicenseBindingInfo {
  id: string
  instanceId: string
  storeId: string
  authorizedHosts: string[]
}

export interface LicenseAccountInfo {
  id: string
  email?: string | null
}

// The payload ZPan Cloud expects for pairing/refresh. Its `runtime` shape is
// fixed by zpan-cloud-sdk and is intentionally decoupled from the richer
// InstanceInfo the About page consumes (which has flat runtime + platform).
export interface CloudInstanceInfo {
  id: string
  name: string
  url: string
  version: string
  commit?: string | null
  runtime?: {
    provider: 'cloudflare' | 'node'
    target: 'cloudflare-worker' | 'node/docker'
  } | null
  server?: { os?: { platform?: string | null; arch?: string | null; release?: string | null } | null } | null
  node?: { version?: string | null } | null
}

export class CloudInvalidResponseError extends Error {
  constructor() {
    super('Cloud response missing certificate')
    this.name = 'CloudInvalidResponseError'
  }
}

export class CloudUnboundError extends Error {
  constructor() {
    super('Instance unbound from cloud')
    this.name = 'CloudUnboundError'
  }
}

export class CloudNetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Cloud network error')
    this.name = 'CloudNetworkError'
  }
}

export interface LicensingCloudGateway {
  createPairing(baseUrl: string, instance: CloudInstanceInfo): Promise<PairingResponse>
  pollPairing(baseUrl: string, code: string): Promise<PairingPollResponse>
  // Throws CloudUnboundError on 401, CloudNetworkError on network failure.
  refreshEntitlement(
    baseUrl: string,
    refreshToken: string,
    instance?: CloudInstanceInfo,
  ): Promise<EntitlementRefreshResponse>
  unbindCloudLicense(baseUrl: string, licenseId: string, refreshToken: string): Promise<void>
  confirmCloudLicense(baseUrl: string, licenseId: string, refreshToken: string): Promise<void>
  createBoundCloudClient(baseUrl: string, refreshToken: string): CloudClient
  requestCloudJson<T, U = T>(
    response: Promise<{ status: number; ok: boolean; json(): Promise<T>; text(): Promise<string> }>,
    responseSchema?: z.ZodType<U>,
  ): Promise<U>
}
