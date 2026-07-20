import { normalizePublicOrigin } from './site-public-origin'

export type WebDavMountPath = '' | '/dav'
export const WEBDAV_AUTH_CHALLENGE = 'Basic realm="ZPan WebDAV"'

export function webDavPublicUrl(sitePublicOrigin: string | null | undefined): URL | null {
  const origin = normalizePublicOrigin(sitePublicOrigin)
  if (!origin) return null

  const url = new URL(origin)
  if (url.hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(url.hostname)) return null
  url.hostname = `dav.${url.hostname}`
  return url
}

export function isPotentialWebDavPublicRequest(requestUrl: string): boolean {
  return new URL(requestUrl).hostname.toLowerCase().startsWith('dav.')
}

export function isWebDavPublicRequest(requestUrl: string, sitePublicOrigin: string | null | undefined): boolean {
  const publicUrl = webDavPublicUrl(sitePublicOrigin)
  return publicUrl !== null && new URL(requestUrl).host === publicUrl.host
}

export function webDavMountPath(requestUrl: string, sitePublicOrigin: string | null | undefined): WebDavMountPath {
  return isWebDavPublicRequest(requestUrl, sitePublicOrigin) ? '' : '/dav'
}

export function webDavPathUrl(requestUrl: string, sitePublicOrigin: string | null | undefined): string {
  const origin = normalizePublicOrigin(sitePublicOrigin) ?? new URL(requestUrl).origin
  return new URL('/dav/', `${origin}/`).toString()
}

export function effectiveWebDavUrl(
  requestUrl: string,
  sitePublicOrigin: string | null | undefined,
  verifiedOrigin: string | null | undefined,
): string {
  const publicUrl = webDavPublicUrl(sitePublicOrigin)
  return publicUrl && publicUrl.origin === normalizePublicOrigin(verifiedOrigin)
    ? `${publicUrl.origin}/`
    : webDavPathUrl(requestUrl, sitePublicOrigin)
}
