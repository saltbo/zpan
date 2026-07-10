import { describe, expect, it } from 'vitest'
import { AppError } from '../ports'
import { decodeImageHostingCursor, encodeImageHostingCursor } from './cursor'

describe('image-hosting cursor codec', () => {
  it('round-trips the complete deterministic keyset tuple', () => {
    const cursor = { createdAt: new Date('2026-07-10T02:00:00.123Z'), id: 'image-42' }

    const encoded = encodeImageHostingCursor(cursor)

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(encoded).not.toContain(cursor.id)
    expect(decodeImageHostingCursor(encoded)).toEqual(cursor)
  })

  it.each([
    ['non-base64url text', 'not+a+cursor'],
    ['non-JSON payload', Buffer.from('not JSON').toString('base64url')],
    ['unsupported version', encodePayload({ v: 2, createdAt: 1, id: 'image-1' })],
    ['missing tuple member', encodePayload({ v: 1, createdAt: 1 })],
    ['invalid timestamp', encodePayload({ v: 1, createdAt: -1, id: 'image-1' })],
    ['empty id', encodePayload({ v: 1, createdAt: 1, id: '' })],
    ['additional field', encodePayload({ v: 1, createdAt: 1, id: 'image-1', extra: true })],
  ])('rejects %s as INVALID_CURSOR', (_case, encoded) => {
    expect(() => decodeImageHostingCursor(encoded)).toThrow(AppError)

    try {
      decodeImageHostingCursor(encoded)
    } catch (error) {
      expect(error).toMatchObject({
        httpStatus: 400,
        message: 'Invalid cursor',
        meta: { reason: 'INVALID_CURSOR' },
      })
    }
  })
})

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}
