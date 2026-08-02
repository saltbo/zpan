import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../usecases/ports'
import { authMiddleware } from './auth'
import type { Env } from './platform'

const verifyAccessTokenRequest = vi.hoisted(() => vi.fn())

vi.mock('@better-auth/oauth-provider/resource-client', () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ verifyAccessTokenRequest }),
  }),
}))

function createApp() {
  const app = new Hono<Env>()
  app.onError((error, c) => {
    const status = (error instanceof AppError ? error.httpStatus : 500) as ContentfulStatusCode
    return c.json({ message: error.message }, status)
  })
  app.use('*', async (c, next) => {
    c.set('auth', {
      $context: Promise.resolve({ baseURL: 'https://files.example', internalAdapter: {} }),
    } as never)
    c.set('platform', { db: {} } as never)
    c.set('deps', {} as never)
    await next()
  })
  app.use('*', authMiddleware)
  app.get('/api/test', (c) => c.json({ ok: true }))
  return app
}

describe('OAuth authentication middleware', () => {
  it('rejects malformed workspace authorization details in an otherwise shaped token', async () => {
    verifyAccessTokenRequest.mockResolvedValue({
      sub: 'user-1',
      client_id: 'client-1',
      act: { sub: 'agent-1', iss: 'https://agent.example' },
      authorization_details: 'not-json',
    })

    const response = await createApp().request('https://files.example/api/test', {
      headers: { Authorization: 'DPoP access-token', DPoP: 'proof' },
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
  })
})
