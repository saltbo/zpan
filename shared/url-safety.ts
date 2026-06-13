/**
 * SSRF guards for user-supplied URLs that the server (or a server-side agent)
 * will fetch — currently the remote-download source URI.
 *
 * The literal-host checks below stop the obvious attacks (metadata endpoint,
 * loopback, RFC 1918). They cannot stop DNS rebinding, where a public hostname
 * resolves to a private address at fetch time — that must be re-checked after
 * DNS resolution by whoever performs the actual fetch.
 */

function ipv4Octets(host: string): [number, number, number, number] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
  const parts = host.split('.').map(Number)
  if (parts.some((n) => n > 255)) return null
  return parts as [number, number, number, number]
}

function isBlockedIpv4(host: string): boolean {
  const octets = ipv4Octets(host)
  if (!octets) return false
  const [a, b] = octets
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT shared address space
  return false
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') return true // unspecified / loopback
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return true // fc00::/7 unique local
  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isBlockedIpv4(mapped[1])
  return false
}

/** True when `hostname` resolves to a non-routable / internal address we must not fetch. */
export function isBlockedUrlHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (isBlockedIpv4(bare)) return true
  if (bare.includes(':') && isBlockedIpv6(bare)) return true
  return false
}

/** Validates an http(s) URL is well-formed and not pointed at an internal host. */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return !isBlockedUrlHost(url.hostname)
}
