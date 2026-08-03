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

function ipv6Groups(host: string): number[] | null {
  let normalized = host.toLowerCase()
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':')
    const octets = ipv4Octets(normalized.slice(separator + 1))
    if (separator < 0 || !octets) return null
    normalized = `${normalized.slice(0, separator + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) | octets[3]
    ).toString(16)}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const parseHalf = (half: string) => {
    if (!half) return []
    const groups = half.split(':')
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
    return groups.map((group) => Number.parseInt(group, 16))
  }
  const left = parseHalf(halves[0])
  const right = parseHalf(halves[1] ?? '')
  if (!left || !right) return null

  const missing = 8 - left.length - right.length
  if (halves.length === 1) return missing === 0 ? left : null
  if (missing < 1) return null
  return [...left, ...Array.from({ length: missing }, () => 0), ...right]
}

function embeddedIpv4(groups: number[]): string | null {
  let high: number
  let low: number

  if (groups[0] === 0x2002) {
    high = groups[1]
    low = groups[2] // 6to4
  } else if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    high = groups[6]
    low = groups[7] // NAT64 well-known prefix
  } else if (groups[0] === 0x2001 && groups[1] === 0) {
    high = groups[6] ^ 0xffff
    low = groups[7] ^ 0xffff // Teredo obscures the client IPv4 address
  } else if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    high = groups[6]
    low = groups[7] // IPv4-mapped
  } else if (groups.slice(0, 4).every((group) => group === 0) && groups[4] === 0xffff && groups[5] === 0) {
    high = groups[6]
    low = groups[7] // IPv4-translated
  } else if (groups.slice(0, 6).every((group) => group === 0) && (groups[6] !== 0 || groups[7] > 1)) {
    high = groups[6]
    low = groups[7] // deprecated IPv4-compatible
  } else {
    return null
  }

  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

function isBlockedIpv6(host: string): boolean {
  const groups = ipv6Groups(host)
  if (!groups) return false
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1) return true
  if ((groups[0] & 0xffc0) === 0xfe80) return true // link-local
  if ((groups[0] & 0xfe00) === 0xfc00) return true // unique local
  const embedded = embeddedIpv4(groups)
  return embedded ? isBlockedIpv4(embedded) : false
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
