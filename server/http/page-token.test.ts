import { encodeBase62Bytes } from '@shared/ids'
import { describe, expect, it } from 'vitest'
import type { Platform } from '../platform/interface'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  decodePageToken,
  directoryCursorCodec,
  encodeNextPageToken,
  encodePageToken,
  pageQueryFingerprint,
  trashCursorCodec,
} from './page-token'

function platform(secret = 'test-secret'): Platform {
  return {
    db: {} as Platform['db'],
    getBinding: () => undefined,
    getEnv: (key) => (key === 'BETTER_AUTH_SECRET' ? secret : undefined),
  }
}

async function signRawBody(body: string, secret: string): Promise<string> {
  const payload = new TextEncoder().encode(body)
  const signed = new Uint8Array(5 + payload.length)
  signed[0] = 1
  new DataView(signed.buffer).setUint32(1, payload.length)
  signed.set(payload, 5)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`zpan:page-token:v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed))
  const envelope = new Uint8Array(signed.length + signature.length)
  envelope.set(signed)
  envelope.set(signature, signed.length)
  return encodeBase62Bytes(envelope)
}

describe('page tokens', () => {
  it('round-trips a signed boundary', async () => {
    const query = await pageQueryFingerprint({ status: 'active', sort: ['createdAt', 'desc'] })
    const token = await encodePageToken(platform(), {
      boundary: { createdAt: 123, id: 'item-1' },
      query,
      now: 1_000,
    })

    expect(query).toMatch(/^[A-Za-z0-9]+$/)
    expect(token).toMatch(/^[A-Za-z0-9]+$/)
    await expect(decodePageToken(platform(), token, { query, now: 2_000 })).resolves.toEqual({
      createdAt: 123,
      id: 'item-1',
    })
  })

  it('rejects tampering, query mismatches, and expired tokens', async () => {
    const query = await pageQueryFingerprint({ status: 'active' })
    const token = await encodePageToken(platform(), {
      boundary: { id: 'item-1' },
      query,
      now: 1_000,
    })

    await expect(decodePageToken(platform(), `${token}x`, { query, now: 2_000 })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
    await expect(decodePageToken(platform(), token, { query: 'different', now: 2_000 })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
    await expect(
      decodePageToken(platform(), token, { query, now: 1_000 + 72 * 60 * 60 * 1_000 }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
  })

  it.each([
    {
      codec: createdAtIdCursorCodec,
      cursor: { createdAt: new Date(123), id: 'item-1' },
    },
    {
      codec: directoryCursorCodec,
      cursor: { dirtype: 1, createdAt: new Date(456), id: 'folder-1' },
    },
    {
      codec: trashCursorCodec,
      cursor: { trashedAt: 789, createdAt: new Date(456), id: 'trash-1' },
    },
  ])('round-trips typed cursors through the shared HTTP boundary', async ({ codec, cursor }) => {
    const query = await pageQueryFingerprint({ pageSize: 50 })
    const token = await encodeNextPageToken(platform(), cursor, { query, codec })

    await expect(decodeOptionalPageToken(platform(), token ?? undefined, { query, codec })).resolves.toEqual(cursor)
  })

  it('handles absent cursors without manufacturing tokens', async () => {
    const query = await pageQueryFingerprint({ pageSize: 50 })

    await expect(
      decodeOptionalPageToken(platform(), undefined, { query, codec: createdAtIdCursorCodec }),
    ).resolves.toBeUndefined()
    await expect(encodeNextPageToken(platform(), null, { query, codec: createdAtIdCursorCodec })).resolves.toBeNull()
  })

  it.each([
    { codec: createdAtIdCursorCodec, boundary: { createdAt: 'invalid', id: 'item-1' } },
    { codec: directoryCursorCodec, boundary: { createdAt: 1, id: 'item-1', dirtype: 'invalid' } },
    { codec: trashCursorCodec, boundary: { createdAt: 1, id: 'item-1', trashedAt: 'invalid' } },
  ])('rejects a signed token whose boundary does not match its codec', async ({ codec, boundary }) => {
    const query = await pageQueryFingerprint({ pageSize: 50 })
    const token = await encodePageToken(platform(), {
      boundary: boundary as never,
      query,
    })

    await expect(decodeOptionalPageToken(platform(), token, { query, codec })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
  })

  it('fails fast when the signing secret is missing', async () => {
    await expect(encodePageToken(platform(''), { boundary: { id: 'item-1' }, query: 'query' })).rejects.toThrow(
      'BETTER_AUTH_SECRET is required',
    )
  })

  it('rejects a correctly signed token with a malformed payload', async () => {
    const token = await signRawBody('not-json', 'test-secret')

    await expect(decodePageToken(platform(), token, { query: 'query' })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
  })

  it('rejects the pre-release Base64url dotted format without a legacy decoder', async () => {
    await expect(decodePageToken(platform(), 'eyJ2IjoxfQ.signature', { query: 'query' })).rejects.toMatchObject({
      httpStatus: 400,
      meta: { reason: 'INVALID_PAGE_TOKEN' },
    })
  })
})
