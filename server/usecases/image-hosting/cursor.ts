import { badRequest, type ImageHostingCursor } from '../ports'

const CURSOR_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

type CursorPayload = {
  v: typeof CURSOR_VERSION
  createdAt: number
  id: string
}

export function encodeImageHostingCursor(cursor: ImageHostingCursor): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    createdAt: cursor.createdAt.getTime(),
    id: cursor.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeImageHostingCursor(value: string): ImageHostingCursor {
  let payload: unknown
  try {
    if (!BASE64URL_PATTERN.test(value)) throw new Error('Invalid base64url')
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error('Non-canonical base64url')
    payload = JSON.parse(decoded)
  } catch {
    throw badRequest('Invalid cursor', 'INVALID_CURSOR')
  }

  if (!isCursorPayload(payload)) throw badRequest('Invalid cursor', 'INVALID_CURSOR')

  return { createdAt: new Date(payload.createdAt), id: payload.id }
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  const keys = Object.keys(payload)
  const createdAt = payload.createdAt
  return (
    keys.length === 3 &&
    keys.includes('v') &&
    keys.includes('createdAt') &&
    keys.includes('id') &&
    payload.v === CURSOR_VERSION &&
    Number.isSafeInteger(createdAt) &&
    (createdAt as number) >= 0 &&
    !Number.isNaN(new Date(createdAt as number).getTime()) &&
    typeof payload.id === 'string' &&
    payload.id.length > 0 &&
    payload.id.length <= 128
  )
}
