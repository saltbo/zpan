import type { Context } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../middleware/platform'
import { serveAvatarBlob } from './avatar-blobs'

function context(scope: string, id: string, getBinding = vi.fn()) {
  const body = vi.fn((value: BodyInit | null, status: number, headers?: Record<string, string>) =>
    Promise.resolve(new Response(value, { status, headers })),
  )
  return {
    body,
    getBinding,
    value: {
      req: { param: (name: string) => (name === 'scope' ? scope : id) },
      get: () => ({ getBinding }),
      body,
    } as unknown as Context<Env>,
  }
}

describe('serveAvatarBlob', () => {
  it.each([
    ['user', 'invalid/user'],
    ['user', 'invalid:user'],
    ['organization', 'Owner123'],
  ])('rejects an invalid public blob key before reading R2', async (scope, id) => {
    const ctx = context(scope, id)
    const response = await serveAvatarBlob(ctx.value)

    expect(response.status).toBe(404)
    expect(ctx.getBinding).not.toHaveBeenCalled()
  })

  it.each(['Owner123', 'legacy_user', 'legacy-user'])('reads a compatible owner ID %s', async (ownerId) => {
    const get = vi.fn().mockResolvedValue({
      arrayBuffer: async () => new TextEncoder().encode('avatar').buffer,
      httpMetadata: { contentType: 'image/png' },
    })
    const ctx = context('team', ownerId, vi.fn().mockReturnValue({ get }))
    const response = await serveAvatarBlob(ctx.value)

    expect(get).toHaveBeenCalledWith(`team/${ownerId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
  })
})
