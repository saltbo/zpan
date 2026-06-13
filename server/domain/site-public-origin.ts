export const SITE_PUBLIC_ORIGIN_KEY = 'site_public_origin'

export function originFromRequestUrl(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    return normalizePublicOrigin(url.origin)
  } catch {
    return null
  }
}

export function normalizePublicOrigin(value: string | undefined | null): string | null {
  const input = value?.trim()
  if (!input) return null

  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}
