import { decodeBase62Bytes, encodeBase62Bytes, isBase62 } from '@shared/ids'
import type { Platform } from '../platform/interface'
import { badRequest } from '../usecases/ports'

const TOKEN_VERSION = 1
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000
const TOKEN_PURPOSE = 'zpan:page-token:v1'
const TOKEN_HEADER_BYTES = 5
const TOKEN_SIGNATURE_BYTES = 32

export type PageBoundary = Record<string, string | number | null>

export interface PageCursorCodec<T> {
  decode(boundary: PageBoundary): T | undefined
  encode(cursor: T): PageBoundary
}

type PageTokenPayload = {
  v: typeof TOKEN_VERSION
  boundary: PageBoundary
  query: string
  expiresAt: number
}

function invalidPageToken(): never {
  throw badRequest('Invalid page token', 'INVALID_PAGE_TOKEN')
}

function secret(platform: Platform): string {
  const value = platform.getEnv('BETTER_AUTH_SECRET')
  if (!value) throw new Error('BETTER_AUTH_SECRET is required')
  return value
}

async function signingKey(platform: Platform): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${TOKEN_PURPOSE}:${secret(platform)}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function pageQueryFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return encodeBase62Bytes(new Uint8Array(digest))
}

export async function encodePageToken(
  platform: Platform,
  input: { boundary: PageBoundary; query: string; now?: number },
): Promise<string> {
  const payload: PageTokenPayload = {
    v: TOKEN_VERSION,
    boundary: input.boundary,
    query: input.query,
    expiresAt: (input.now ?? Date.now()) + TOKEN_TTL_MS,
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const signed = new Uint8Array(TOKEN_HEADER_BYTES + payloadBytes.length)
  signed[0] = TOKEN_VERSION
  new DataView(signed.buffer).setUint32(1, payloadBytes.length)
  signed.set(payloadBytes, TOKEN_HEADER_BYTES)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(platform), signed))
  const envelope = new Uint8Array(signed.length + signature.length)
  envelope.set(signed)
  envelope.set(signature, signed.length)
  return encodeBase62Bytes(envelope)
}

export async function decodePageToken(
  platform: Platform,
  token: string,
  input: { query: string; now?: number },
): Promise<PageBoundary> {
  if (!isBase62(token)) invalidPageToken()
  let envelope: Uint8Array
  try {
    envelope = decodeBase62Bytes(token)
  } catch {
    invalidPageToken()
  }
  if (envelope.length < TOKEN_HEADER_BYTES + TOKEN_SIGNATURE_BYTES || envelope[0] !== TOKEN_VERSION) invalidPageToken()
  const payloadLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(1)
  const signedLength = TOKEN_HEADER_BYTES + payloadLength
  if (envelope.length !== signedLength + TOKEN_SIGNATURE_BYTES) invalidPageToken()
  const signed = envelope.slice(0, signedLength)
  const verificationSignature = envelope.slice(signedLength)
  const valid = await crypto.subtle.verify('HMAC', await signingKey(platform), verificationSignature, signed)
  if (!valid) invalidPageToken()

  let payload: PageTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(signed.slice(TOKEN_HEADER_BYTES))) as PageTokenPayload
  } catch {
    invalidPageToken()
  }
  if (
    payload.v !== TOKEN_VERSION ||
    typeof payload.boundary !== 'object' ||
    payload.boundary === null ||
    payload.query !== input.query ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt <= (input.now ?? Date.now())
  ) {
    invalidPageToken()
  }
  return payload.boundary
}

export async function decodeOptionalPageToken<T>(
  platform: Platform,
  token: string | undefined,
  input: { query: string; codec: PageCursorCodec<T> },
): Promise<T | undefined> {
  if (!token) return undefined
  const cursor = input.codec.decode(await decodePageToken(platform, token, { query: input.query }))
  if (!cursor) invalidPageToken()
  return cursor
}

export async function encodeNextPageToken<T>(
  platform: Platform,
  cursor: T | null,
  input: { query: string; codec: PageCursorCodec<T> },
): Promise<string | null> {
  if (!cursor) return null
  return encodePageToken(platform, { query: input.query, boundary: input.codec.encode(cursor) })
}

type CreatedAtIdCursor = { createdAt: Date; id: string }

export const createdAtIdCursorCodec: PageCursorCodec<CreatedAtIdCursor> = {
  decode(boundary) {
    if (typeof boundary.createdAt !== 'number' || typeof boundary.id !== 'string') return undefined
    return { createdAt: new Date(boundary.createdAt), id: boundary.id }
  },
  encode(cursor) {
    return { createdAt: cursor.createdAt.getTime(), id: cursor.id }
  },
}

type DirectoryCursor = CreatedAtIdCursor & { dirtype: number }

export const directoryCursorCodec: PageCursorCodec<DirectoryCursor> = {
  decode(boundary) {
    const cursor = createdAtIdCursorCodec.decode(boundary)
    if (!cursor || typeof boundary.dirtype !== 'number') return undefined
    return { dirtype: boundary.dirtype, ...cursor }
  },
  encode(cursor) {
    return { dirtype: cursor.dirtype, ...createdAtIdCursorCodec.encode(cursor) }
  },
}

type TrashCursor = CreatedAtIdCursor & { trashedAt: number }

export const trashCursorCodec: PageCursorCodec<TrashCursor> = {
  decode(boundary) {
    const cursor = createdAtIdCursorCodec.decode(boundary)
    if (!cursor || typeof boundary.trashedAt !== 'number') return undefined
    return { trashedAt: boundary.trashedAt, ...cursor }
  },
  encode(cursor) {
    return { trashedAt: cursor.trashedAt, ...createdAtIdCursorCodec.encode(cursor) }
  },
}
