/**
 * Canonical image MIME → file-extension map. Endpoints keep their own
 * allow-lists (which subset of these they accept); this is only the lookup
 * for naming the stored object, so it is the superset of every allow-list.
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

/** File extension for an image MIME type, or 'bin' when unknown. */
export function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] ?? 'bin'
}
