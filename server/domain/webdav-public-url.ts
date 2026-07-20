export type WebDavMountPath = '' | '/dav'

export function parseWebDavPublicUrl(raw: string | undefined): URL | null {
  const value = raw?.trim()
  if (!value) return null

  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WEBDAV_PUBLIC_URL must use http or https')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WEBDAV_PUBLIC_URL must be an origin without credentials, path, query, or fragment')
  }
  return url
}

export function isWebDavPublicRequest(requestUrl: string, rawPublicUrl: string | undefined): boolean {
  const publicUrl = parseWebDavPublicUrl(rawPublicUrl)
  return publicUrl !== null && new URL(requestUrl).host === publicUrl.host
}

export function webDavMountPath(requestUrl: string, rawPublicUrl: string | undefined): WebDavMountPath {
  return isWebDavPublicRequest(requestUrl, rawPublicUrl) ? '' : '/dav'
}

export function effectiveWebDavUrl(requestUrl: string, rawPublicUrl: string | undefined): string {
  const publicUrl = parseWebDavPublicUrl(rawPublicUrl)
  return publicUrl ? `${publicUrl.origin}/` : new URL('/dav/', requestUrl).toString()
}
