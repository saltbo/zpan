interface CfConfig {
  apiToken: string
  zoneId: string
  cnameTarget: string
}

interface CfHostnameStatus {
  status: 'pending' | 'active' | 'moved' | 'deleted' | 'blocked'
  ssl_status: string
}

// CfCustomHostnamesClient is a thin wrapper around the Cloudflare Custom
// Hostnames API (CF for SaaS). When env vars are absent (Node self-hosted),
// register/delete are no-ops and getStatus always returns 'pending' so
// domains never auto-verify without crashing the server.
export class CfCustomHostnamesClient {
  private readonly cfg: CfConfig | null

  constructor(cfg: CfConfig | null) {
    this.cfg = cfg
  }

  async register(hostname: string): Promise<{ id: string }> {
    if (!this.cfg) return { id: '' }

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.cfg.zoneId}/custom_hostnames`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname,
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      if (res.status === 409) throw new CfConflictError(`Domain already registered at Cloudflare: ${text}`)
      throw new Error(`CF registerHostname failed (${res.status}): ${text}`)
    }

    const data = (await res.json()) as { result: { id: string } }
    return { id: data.result.id }
  }

  async getStatus(id: string): Promise<CfHostnameStatus> {
    if (!this.cfg || !id) return { status: 'pending', ssl_status: '' }

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.cfg.zoneId}/custom_hostnames/${id}`, {
      headers: { Authorization: `Bearer ${this.cfg.apiToken}` },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`CF getHostnameStatus failed (${res.status}): ${text}`)
    }

    const data = (await res.json()) as { result: { status: string; ssl: { status: string } } }
    return {
      status: data.result.status as CfHostnameStatus['status'],
      ssl_status: data.result.ssl?.status ?? '',
    }
  }

  async delete(id: string): Promise<void> {
    if (!this.cfg || !id) return

    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.cfg.zoneId}/custom_hostnames/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.cfg.apiToken}` },
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`CF deleteHostname failed (${res.status}): ${text}`)
    }
  }
}

export class CfConflictError extends Error {}

export function createCfClient(getEnv: (key: string) => string | undefined): CfCustomHostnamesClient {
  const apiToken = getEnv('CF_API_TOKEN')
  const zoneId = getEnv('CF_ZONE_ID')
  const cnameTarget = getEnv('CF_CNAME_TARGET')

  if (!apiToken || !zoneId || !cnameTarget) {
    return new CfCustomHostnamesClient(null)
  }

  return new CfCustomHostnamesClient({ apiToken, zoneId, cnameTarget })
}
