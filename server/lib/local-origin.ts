/**
 * Returns true when the origin points at localhost, the loopback interface,
 * or an RFC 1918 private network address.
 *
 * Why trusting these is safe for CSRF purposes: browsers set the Origin
 * header themselves and a public website cannot forge it. An Origin on a
 * loopback or private address therefore proves the page was served from the
 * user's own machine or LAN — the self-hosted scenario where requiring a
 * manual TRUSTED_ORIGINS entry is pure friction.
 */
export function isLocalNetworkOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '[::1]') return true
  return isPrivateIpv4(host)
}

function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  const [a, b] = host.split('.').map(Number)
  if (a > 255 || b > 255) return false
  if (a === 127 || a === 10) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}
