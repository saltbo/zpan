import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../usecases/ports'
import { authMiddleware, mapOauthVerificationError } from './auth'
import type { Env } from './platform'

const verifyAccessTokenRequest = vi.hoisted(() => vi.fn())

vi.mock('@better-auth/oauth-provider/resource-client', () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ verifyAccessTokenRequest }),
  }),
}))

function createApp() {
  const app = new Hono<Env>()
  const errors: unknown[] = []
  app.onError((error) => {
    errors.push(error)
    const status = (error instanceof AppError ? error.httpStatus : 500) as ContentfulStatusCode
    return new Response(JSON.stringify({ message: error.message }), {
      status,
      headers: { 'Content-Type': 'application/json', ...(error instanceof AppError ? error.meta.headers : {}) },
    })
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
  return { app, errors }
}

describe('OAuth authentication middleware', () => {
  beforeEach(() => verifyAccessTokenRequest.mockReset())

  it('rejects malformed workspace authorization details in an otherwise shaped token', async () => {
    verifyAccessTokenRequest.mockResolvedValue({
      sub: 'user-1',
      client_id: 'client-1',
      act: { sub: 'agent-1', iss: 'https://agent.example' },
      authorization_details: 'not-json',
    })

    const { app, errors } = createApp()
    const response = await app.request('https://files.example/api/test', {
      headers: { Authorization: 'DPoP access-token', DPoP: 'proof' },
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"')
    await expect(response.json()).resolves.toEqual({ message: 'Unauthorized' })
    expect(errors[0]).toBeInstanceOf(AppError)
    expect((errors[0] as AppError).meta.diagnostics?.reason).toBe('OAUTH_WORKSPACE_CLAIM_INVALID')
  })

  it('preserves the standards-based verifier challenge and records a server-only DPoP diagnosis', () => {
    const mapped = mapOauthVerificationError(
      {
        status: 'UNAUTHORIZED',
        statusCode: 401,
        body: {
          error: 'invalid_dpop_proof',
          error_description: 'DPoP proof jti has already been used',
        },
        headers: {
          'WWW-Authenticate': 'DPoP error="invalid_dpop_proof", algs="ES256 EdDSA"',
        },
      },
      'https://files.example/api',
    )

    expect(mapped.httpStatus).toBe(401)
    expect(mapped.message).toBe('Unauthorized')
    expect(mapped.meta.headers?.['WWW-Authenticate']).toBe('DPoP error="invalid_dpop_proof", algs="ES256 EdDSA"')
    expect(mapped.meta.diagnostics).toEqual({
      reason: 'OAUTH_DPOP_REPLAY',
      message: 'DPoP proof jti has already been used',
    })
  })
})
