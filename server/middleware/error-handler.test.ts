import type { Context } from 'hono'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/http-errors'
import { NameConflictError } from '../usecases/ports'
import { isHandledError, renderError } from './error-handler'
import type { Env } from './platform'

// Build a real Context so renderError's c.json / c.set behave as in production.
async function ctx(): Promise<Context<Env>> {
  let captured!: Context<Env>
  const app = new Hono<Env>()
  app.get('/x', (c) => {
    c.set('errorLog', null)
    captured = c as unknown as Context<Env>
    return c.body(null, 200)
  })
  await app.request('/x')
  return captured
}

describe('renderError', () => {
  it('renders an ApiError as its AIP-193 body + status and records errorLog', async () => {
    const c = await ctx()
    const res = renderError(c, new ApiError(402, 'Insufficient credits', { reason: 'INSUFFICIENT_CREDITS' }))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      error: { status: 'FAILED_PRECONDITION', message: 'Insufficient credits' },
    })
    expect(c.get('errorLog')).toEqual({ reason: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits' })
  })

  it('renders a mapped domain error with its mapped status + reason', async () => {
    const c = await ctx()
    const res = renderError(c, new NameConflictError('doc.txt', 'id-1'))
    expect(res.status).toBe(409)
    expect(c.get('errorLog')?.reason).toBe('NAME_CONFLICT')
  })

  it('renders an unknown error as a generic 500 while logging the full cause chain', async () => {
    const c = await ctx()
    const err = new Error('top') as Error & { cause?: unknown }
    err.cause = new Error('D1_ERROR: disk full')
    const res = renderError(c, err)
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Internal Server Error')
    const log = c.get('errorLog')
    expect(log?.reason).toBe('INTERNAL')
    expect(log?.message).toContain('top')
    expect(log?.message).toContain('D1_ERROR: disk full')
  })
})

describe('isHandledError', () => {
  it('is true for ApiError and mapped domain errors, false otherwise', () => {
    expect(isHandledError(new ApiError(400, 'x'))).toBe(true)
    expect(isHandledError(new NameConflictError('a', 'b'))).toBe(true)
    expect(isHandledError(new Error('boom'))).toBe(false)
    expect(isHandledError(null)).toBe(false)
  })
})
