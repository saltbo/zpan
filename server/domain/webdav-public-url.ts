import { normalizePublicOrigin } from './site-public-origin'

export type WebDavMountPath = '' | '/dav'
export const WEBDAV_AUTH_CHALLENGE = 'Basic realm="ZPan WebDAV"'

function normalizeWebDavDomain(value: string | null | undefined): string | null {
  const domain = value?.trim().toLowerCase()
  if (!domain) return null

  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
  if (domain.length > 253 || !new RegExp(`^${label}(?:\\.${label})*$`).test(domain)) {
    throw new Error('WebDAV domain must be a hostname without a protocol, port, or path')
  }
  return domain
}

export function webDavPublicUrl(
  sitePublicOrigin: string | null | undefined,
  configuredDomain?: string | null,
): URL | null {
  const origin = normalizePublicOrigin(sitePublicOrigin)
  if (!origin) return null

  const url = new URL(origin)
  const domain = normalizeWebDavDomain(configuredDomain)
  if (domain) {
    url.hostname = domain
    url.port = ''
    return url
  }
  if (url.hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null
  url.hostname = `dav.${url.hostname}`
  return url
}

export function isPotentialWebDavPublicRequest(requestUrl: string): boolean {
  const url = new URL(requestUrl)
  return url.hostname.toLowerCase().startsWith('dav.') || url.pathname === '/dav' || url.pathname.startsWith('/dav/')
}

export function isWebDavPublicRequest(
  requestUrl: string,
  sitePublicOrigin: string | null | undefined,
  configuredDomain?: string | null,
): boolean {
  const publicUrl = webDavPublicUrl(sitePublicOrigin, configuredDomain)
  return publicUrl !== null && new URL(requestUrl).host === publicUrl.host
}

export function webDavMountPath(
  requestUrl: string,
  sitePublicOrigin: string | null | undefined,
  configuredDomain?: string | null,
): WebDavMountPath {
  return isWebDavPublicRequest(requestUrl, sitePublicOrigin, configuredDomain) ? '' : '/dav'
}

export function webDavPathUrl(requestUrl: string, sitePublicOrigin: string | null | undefined): string {
  const origin = normalizePublicOrigin(sitePublicOrigin) ?? new URL(requestUrl).origin
  return new URL('/dav/', `${origin}/`).toString()
}

export function effectiveWebDavUrl(
  requestUrl: string,
  sitePublicOrigin: string | null | undefined,
  verifiedOrigin: string | null | undefined,
  configuredDomain?: string | null,
): string {
  const publicUrl = webDavPublicUrl(sitePublicOrigin, configuredDomain)
  return publicUrl && publicUrl.origin === normalizePublicOrigin(verifiedOrigin)
    ? `${publicUrl.origin}/`
    : webDavPathUrl(requestUrl, sitePublicOrigin)
}
