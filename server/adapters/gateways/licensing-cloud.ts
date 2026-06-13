import type { z } from 'zod'
import { type CloudClient, createCloudClient } from 'zpan-cloud-sdk'
import {
  type CloudInstanceInfo,
  CloudInvalidResponseError,
  CloudNetworkError,
  CloudUnboundError,
  type EntitlementRefreshResponse,
  type LicensingCloudGateway,
  type PairingPollResponse,
  type PairingResponse,
} from '../../usecases/ports'

const CLOUD_REQUEST_TIMEOUT_MS = 10_000
const JSON_HEADERS = { 'content-type': 'application/json' }

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
  const client = createBoundCloudClient(baseUrl, refreshToken)
  const res = await cloudResponse(
    instance ? client.entitlements.$post({ json: { instance } }) : client.entitlements.$post({ json: undefined }),
  )

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

// Tell the cloud this instance verified + stored the certificate, so the pairing
// page can resolve to success instead of claiming success the moment it approves.
export async function confirmCloudLicense(baseUrl: string, licenseId: string, refreshToken: string): Promise<void> {
  const res = await cloudResponse(
    createBoundCloudClient(baseUrl, refreshToken).licenses[':id'].$patch({
      param: { id: licenseId },
      json: { status: 'confirmed' },
    }),
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud confirm failed: ${res.status} ${text}`)
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

export function createLicensingCloudGateway(): LicensingCloudGateway {
  return {
    createPairing,
    pollPairing,
    refreshEntitlement,
    unbindCloudLicense,
    confirmCloudLicense,
    createBoundCloudClient,
    requestCloudJson,
  }
}
