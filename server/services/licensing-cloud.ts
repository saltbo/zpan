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
}

export interface EntitlementRefreshResponse {
  refresh_token: string
  certificate: string
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

  return res.json() as Promise<PairingResponse>
}

export async function pollPairing(baseUrl: string, code: string): Promise<PairingPollResponse> {
  const res = await cloudFetch(baseUrl, `/api/pairings/${encodeURIComponent(code)}`, {
    method: 'GET',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Cloud poll failed: ${res.status} ${text}`)
  }

  return res.json() as Promise<PairingPollResponse>
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

  return res.json() as Promise<EntitlementRefreshResponse>
}
