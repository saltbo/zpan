// The StremThru Store API shapes ZPan answers with (docs/design/torrents.md §8).
// Addons such as MediaFusion and Comet speak this protocol, so names, statuses,
// and error codes follow StremThru rather than ZPan's own API.

import { parseMagnetInfoHash } from './torrent-info'

export const STREMTHRU_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const

export type StremThruErrorCode = keyof typeof STREMTHRU_ERROR_STATUS

export class StremThruError extends Error {
  constructor(
    readonly code: StremThruErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StremThruError'
  }

  get status(): number {
    return STREMTHRU_ERROR_STATUS[this.code]
  }
}

export type StremThruTorzStatus =
  | 'cached'
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'downloaded'
  | 'uploading'
  | 'failed'
  | 'invalid'
  | 'unknown'

export interface StremThruFile {
  index: number
  link?: string
  path: string
  name: string
  size: number
}

// Check answers at most this many hashes per request.
export const STREMTHRU_CHECK_MAX_HASHES = 500
export const STREMTHRU_LIST_DEFAULT_LIMIT = 100
export const STREMTHRU_LIST_MAX_LIMIT = 500

// A Torrents list entry's status as a StremThru torz status.
export function torzStatus(entryStatus: string): StremThruTorzStatus {
  switch (entryStatus) {
    case 'ready':
      return 'downloaded'
    case 'downloading':
      return 'downloading'
    case 'verifying':
      return 'processing'
    // A paused download does not finish until someone resumes it, so addons
    // stop waiting for it.
    case 'paused':
    case 'failed':
      return 'failed'
    default:
      return 'queued'
  }
}

// One file of a torrent as StremThru lists it: `index` is the file's position in
// the info dictionary, and `path` is its path inside the torrent's root folder.
export function torzFile(file: { fileIdx: number; path: string; size: number }, link?: string): StremThruFile {
  const segments = file.path.split('/').filter(Boolean)
  return {
    index: file.fileIdx,
    ...(link ? { link } : {}),
    path: `/${segments.join('/')}`,
    name: segments.at(-1) ?? file.path,
    size: file.size,
  }
}

const LINK_PREFIX = 'zpan:st:'
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

// `files[].link` is an opaque reference to a file of the torrent within a
// Torrents list entry; only link/generate resolves it, and only for the same
// workspace.
export function encodeFileLink(entryId: string, fileId: string): string {
  return `${LINK_PREFIX}${entryId}.${fileId}`
}

export function decodeFileLink(link: string): { entryId: string; fileId: string } | null {
  if (!link.startsWith(LINK_PREFIX)) return null
  const [entryId, fileId, ...rest] = link.slice(LINK_PREFIX.length).split('.')
  if (rest.length > 0 || !entryId || !fileId || !ID_RE.test(entryId) || !ID_RE.test(fileId)) return null
  return { entryId, fileId }
}

// A check hash: a hex or base32 infoHash, or a magnet link carrying one.
export function parseCheckHash(value: string): string | null {
  const trimmed = value.trim()
  if (/^[0-9a-f]{40}$/i.test(trimmed)) return trimmed.toLowerCase()
  if (/^[a-z2-7]{32}$/i.test(trimmed)) return parseMagnetInfoHash(`magnet:?xt=urn:btih:${trimmed}`)
  if (/^magnet:\?/i.test(trimmed)) return parseMagnetInfoHash(trimmed)
  return null
}

export function magnetFor(infoHash: string): string {
  return `magnet:?xt=urn:btih:${infoHash}`
}

// The download source for an added link: a magnet (or a bare infoHash), or a
// .torrent URL.
export function torzSource(link: string): { type: 'magnet' | 'torrent_url'; uri: string } | null {
  const trimmed = link.trim()
  if (/^magnet:\?/i.test(trimmed)) return parseMagnetInfoHash(trimmed) ? { type: 'magnet', uri: trimmed } : null
  const hash = parseCheckHash(trimmed)
  if (hash) return { type: 'magnet', uri: magnetFor(hash) }
  if (/^https?:\/\//i.test(trimmed)) return { type: 'torrent_url', uri: trimmed }
  return null
}

// The key from `X-StremThru-Store-Authorization` or `Authorization`, either as
// `Bearer <key>` or bare.
export function storeToken(headers: { storeAuthorization?: string | null; authorization?: string | null }) {
  for (const value of [headers.storeAuthorization, headers.authorization]) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
    const token = (bearer ? bearer[1] : trimmed).trim()
    if (token && !/\s/.test(token)) return token
  }
  return null
}
