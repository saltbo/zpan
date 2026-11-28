// Stream links of torrents that stream while they download
// (docs/design/torrents.md §14). Players cannot send headers, so the link
// carries a signed token naming the torrent file and when the link expires.

import type { Platform } from '../platform/interface'

const TOKEN_PURPOSE = 'zpan:torrent-stream:v1'

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

async function signingKey(platform: Platform): Promise<CryptoKey> {
  const secret = platform.getEnv('BETTER_AUTH_SECRET')
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${TOKEN_PURPOSE}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function encodeStreamToken(platform: Platform, torrentFileId: string, expiresAt: Date): Promise<string> {
  const payload = encode(new TextEncoder().encode(`${torrentFileId}.${expiresAt.getTime()}`))
  const signature = await crypto.subtle.sign('HMAC', await signingKey(platform), new TextEncoder().encode(payload))
  return `${payload}.${encode(new Uint8Array(signature))}`
}

// The torrent file a token names, or null when it is forged or expired.
export async function decodeStreamToken(
  platform: Platform,
  token: string,
  now = Date.now(),
): Promise<{ torrentFileId: string } | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(platform),
    new Uint8Array(Buffer.from(signature, 'base64url')),
    new TextEncoder().encode(payload),
  )
  if (!valid) return null
  const [torrentFileId, expires] = Buffer.from(payload, 'base64url').toString('utf8').split('.')
  if (!torrentFileId || !expires || Number(expires) < now) return null
  return { torrentFileId }
}
