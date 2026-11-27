// Connection details for StremThru addons (docs/design/torrents.md §8).
// MediaFusion reads the store's base URL from its API Token field as
// `{url}|{store}:{token}`; the store must be one it lists, and ZPan ignores it.

const MEDIAFUSION_STORE_NAME = 'torbox'

export function stremThruAddress(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/stremthru`
}

export function mediaFusionToken(origin: string, key: string): string {
  return `${stremThruAddress(origin)}|${MEDIAFUSION_STORE_NAME}:${key}`
}
