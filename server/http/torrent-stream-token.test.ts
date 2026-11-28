import { describe, expect, it } from 'vitest'
import type { Platform } from '../platform/interface'
import { decodeStreamToken, encodeStreamToken } from './torrent-stream-token'

function platform(secret = 'test-secret'): Platform {
  return {
    db: {} as Platform['db'],
    getBinding: () => undefined,
    getEnv: (key) => (key === 'BETTER_AUTH_SECRET' ? secret : undefined),
  }
}

describe('stream tokens', () => {
  it('names the torrent file until the token expires', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    const token = await encodeStreamToken(platform(), 'file-1', expiresAt)
    expect(await decodeStreamToken(platform(), token)).toEqual({ torrentFileId: 'file-1' })
    expect(await decodeStreamToken(platform(), token, expiresAt.getTime() + 1)).toBeNull()
  })

  it('refuses a token signed with another secret or altered', async () => {
    const token = await encodeStreamToken(platform(), 'file-1', new Date(Date.now() + 60_000))
    expect(await decodeStreamToken(platform('other-secret'), token)).toBeNull()
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(`file-2.${Date.now() + 60_000}`).toString('base64url')}.${signature}`
    expect(await decodeStreamToken(platform(), forged)).toBeNull()
    expect(await decodeStreamToken(platform(), `${token}.extra`)).toBeNull()
    expect(await decodeStreamToken(platform(), 'garbage')).toBeNull()
  })
})
