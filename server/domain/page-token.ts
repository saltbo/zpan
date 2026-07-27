import type { Platform } from '../platform/interface'
import { badRequest } from '../usecases/ports'

const TOKEN_VERSION = 1
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000
const TOKEN_PURPOSE = 'zpan:page-token:v1'

export type PageBoundary = Record<string, string | number | null>

type PageTokenPayload = {
  v: typeof TOKEN_VERSION
  boundary: PageBoundary
  query: string
  expiresAt: number
}

function invalidPageToken(): never {
  throw badRequest('Invalid page token', 'INVALID_PAGE_TOKEN')
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'))
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
  return encodeBase64Url(new Uint8Array(digest))
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
  const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign('HMAC', await signingKey(platform), new TextEncoder().encode(body))
  return `${body}.${encodeBase64Url(new Uint8Array(signature))}`
}

export async function decodePageToken(
  platform: Platform,
  token: string,
  input: { query: string; now?: number },
): Promise<PageBoundary> {
  const [body, signature, extra] = token.split('.')
  if (!body || !signature || extra) invalidPageToken()

  let signatureBytes: Uint8Array
  try {
    signatureBytes = decodeBase64Url(signature)
  } catch {
    invalidPageToken()
  }
  const verificationSignature = new Uint8Array(signatureBytes.byteLength)
  verificationSignature.set(signatureBytes)
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(platform),
    verificationSignature,
    new TextEncoder().encode(body),
  )
  if (!valid) invalidPageToken()

  let payload: PageTokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(body))) as PageTokenPayload
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
