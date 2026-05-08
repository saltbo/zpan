// HTTP client for cloud.zpan.space — pairing and entitlement refresh.
// All requests have a 10s timeout. Cloud API uses snake_case JSON payloads.

const CLOUD_REQUEST_TIMEOUT_MS = 10_000

export interface PairingResponse {
  code: string
  pairing_url: string
  expires_at: string
}

export interface PairingPollResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  refresh_token?: string
  certificate?: string
  binding?: LicenseBindingInfo
  account?: LicenseAccountInfo
}

export interface EntitlementRefreshResponse {
  refresh_token: string
  certificate: string
  binding: LicenseBindingInfo
  account: LicenseAccountInfo
  next_refresh_after?: string
}

export interface LicenseBindingInfo {
  id: string
  instance_id: string
  store_id: string
  authorized_hosts: string[]
}

export interface LicenseAccountInfo {
  id: string
  email?: string | null
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

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

async function cloudFetch(baseUrl: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: withTimeout(CLOUD_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw new CloudNetworkError(err)
  }
}

export async function createPairing(
  baseUrl: string,
  instanceId: string,
  instanceName: string,
  instanceHost: string,
): Promise<PairingResponse> {
  const res = await cloudFetch(baseUrl, '/api/pairings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance_id: instanceId, instance_name: instanceName, instance_host: instanceHost }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud pairing failed: ${res.status} ${text}`)
  }

  return unwrapCloudData<PairingResponse>(await res.json())
}

export async function pollPairing(baseUrl: string, code: string): Promise<PairingPollResponse> {
  const res = await cloudFetch(baseUrl, `/api/pairings/${encodeURIComponent(code)}`, {
    method: 'GET',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud poll failed: ${res.status} ${text}`)
  }

  return unwrapCloudData<PairingPollResponse>(await res.json())
}

// Calls POST /api/entitlements with the stored refresh_token.
// Throws CloudUnboundError on 401 (instance was unbound from cloud side).
// Throws CloudNetworkError on network failure.
export async function refreshEntitlement(baseUrl: string, refreshToken: string): Promise<EntitlementRefreshResponse> {
  const res = await cloudFetch(baseUrl, '/api/entitlements', {
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshToken}` },
  })

  if (res.status === 401) {
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

export async function requestBoundCloudJson(
  baseUrl: string,
  path: string,
  refreshToken: string,
  init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; payload?: object },
): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${refreshToken}` }
  if (init.payload) headers['Content-Type'] = 'application/json'

  const res = await cloudFetch(baseUrl, path, {
    method: init.method,
    headers,
    body: init.payload ? JSON.stringify(init.payload) : undefined,
  })

  if (res.status === 204) return null

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error =
      data &&
      typeof data === 'object' &&
      'error' in data &&
      data.error &&
      typeof data.error === 'object' &&
      'code' in data.error &&
      typeof data.error.code === 'string'
        ? data.error.code
        : data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : null
    throw new Error(error ?? `cloud_request_failed_${res.status}`)
  }

  if (data && typeof data === 'object' && 'data' in data) return data.data
  return data
}

export async function postBoundCloudJson(
  baseUrl: string,
  path: string,
  refreshToken: string,
  payload: object,
): Promise<unknown> {
  return requestBoundCloudJson(baseUrl, path, refreshToken, { method: 'POST', payload })
}

function unwrapCloudData<T>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in data) return data.data as T
  return data as T
}
