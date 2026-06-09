// Instance metadata reported to ZPan Cloud and shown on the admin About page.
export interface InstanceInfo {
  id: string
  name: string
  url: string
  version: string
  runtime?: {
    provider: 'cloudflare' | 'node'
    target: 'cloudflare-worker' | 'node/docker'
  } | null
  server?: {
    os?: {
      platform?: string | null
      arch?: string | null
      release?: string | null
    } | null
  } | null
  node?: {
    version?: string | null
  } | null
}
