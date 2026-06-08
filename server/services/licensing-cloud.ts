import type { z } from 'zod'
import { type CloudClient, createCloudClient } from 'zpan-cloud-sdk'

const CLOUD_REQUEST_TIMEOUT_MS = 10_000
const JSON_HEADERS = { 'content-type': 'application/json' }

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

export interface CloudInstanceInfo {
  id: string
  name: string
  url: string
  version: string
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

function cloudApiBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api`
}

export function createBoundCloudClient(baseUrl: string, refreshToken: string): CloudClient {
  return createCloudClient({ baseUrl: cloudApiBaseUrl(baseUrl), token: refreshToken, headers: JSON_HEADERS })
}

function createAnonymousCloudClient(baseUrl: string): CloudClient {
  return createCloudClient({ baseUrl: cloudApiBaseUrl(baseUrl), headers: JSON_HEADERS })
}

async function cloudResponse<
  T extends { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> },
>(response: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('cloud_request_timeout')), CLOUD_REQUEST_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    throw new CloudNetworkError(err)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function unwrapCloudResponse<T, U = T>(
  response: {
    status: number
    ok: boolean
    json(): Promise<T>
  },
  responseSchema?: z.ZodType<U>,
): Promise<U> {
  if (response.status === 204) return null as U
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(cloudErrorCode(data) ?? `cloud_request_failed_${response.status}`)
  const payload = data && typeof data === 'object' && 'data' in data ? data.data : data
  if (!responseSchema) return payload as U
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) throw new Error('invalid_cloud_response')
  return parsed.data
}

export async function requestCloudJson<T, U = T>(
  response: Promise<{
    status: number
    ok: boolean
    json(): Promise<T>
    text(): Promise<string>
  }>,
  responseSchema?: z.ZodType<U>,
): Promise<U> {
  return unwrapCloudResponse(await cloudResponse(response), responseSchema)
}

export async function createPairing(baseUrl: string, instance: CloudInstanceInfo): Promise<PairingResponse> {
  const res = await cloudResponse(
    createAnonymousCloudClient(baseUrl).pairings.$post({
      json: { instance },
    }),
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud pairing failed: ${res.status} ${text}`)
  }

  return unwrapCloudData<PairingResponse>(await res.json())
}

export async function pollPairing(baseUrl: string, code: string): Promise<PairingPollResponse> {
  const res = await cloudResponse(createAnonymousCloudClient(baseUrl).pairings[':code'].$get({ param: { code } }))

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud poll failed: ${res.status} ${text}`)
  }

  return unwrapCloudData<PairingPollResponse>(await res.json())
}

// Throws CloudUnboundError on 401 (instance was unbound from cloud side).
// Throws CloudNetworkError on network failure.
export async function refreshEntitlement(
  baseUrl: string,
  refreshToken: string,
  instance?: CloudInstanceInfo,
): Promise<EntitlementRefreshResponse> {
  const postEntitlement = createBoundCloudClient(baseUrl, refreshToken).entitlements.$post as unknown as (args?: {
    json?: { instance: CloudInstanceInfo }
  }) => Promise<Response>
  const res = await cloudResponse(instance ? postEntitlement({ json: { instance } }) : postEntitlement())

  if ((res.status as number) === 401) {
    throw new CloudUnboundError()
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud refresh failed: ${res.status} ${text}`)
  }

  const data = unwrapCloudData<EntitlementRefreshResponse>(await res.json())
  if (!data.certificate) throw new CloudInvalidResponseError()
  return data
}

export async function unbindCloudLicense(baseUrl: string, licenseId: string, refreshToken: string): Promise<void> {
  const res = await cloudResponse(
    createBoundCloudClient(baseUrl, refreshToken).licenses[':id'].$delete({ param: { id: licenseId } }),
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud unbind failed: ${res.status} ${text}`)
  }
}

function unwrapCloudData<T>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in data) return data.data as T
  return data as T
}

function cloudErrorCode(data: unknown) {
  if (!data || typeof data !== 'object' || !('error' in data)) return null
  const error = data.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return null
}
