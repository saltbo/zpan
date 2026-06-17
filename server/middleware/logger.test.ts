import { ErrorReason } from '@shared/schemas'
import type { Handler } from 'hono'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError } from '../http/openapi'
import { NameConflictError } from '../usecases/ports'
import { renderError } from './error-handler'
import { accessLog } from './logger'
import type { Env } from './platform'

// Parse one `key="json"` access-log line into a record.
function parseLine(line: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    out[m[1]] = m[2].startsWith('"') ? (JSON.parse(m[2]) as string) : m[2]
  }
  return out
}

describe('accessLog', () => {
  let lines: string[]
  beforeEach(() => {
    lines = []
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(line)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  // Mirror production: accessLog at the boundary, errorLog initialised like
  // platformMiddleware, and app.onError rendering thrown errors via renderError
  // (Hono routes throws there, not to a middleware catch — see app.ts).
  function appWith(handler: Handler<Env>) {
    const app = new Hono<Env>()
    app.use('*', accessLog)
    app.use('*', async (c, next) => {
      c.set('errorLog', null)
      await next()
    })
    app.get('/x', handler)
    app.onError((err, c) => renderError(c, err))
    return app
  }

  it('logs a success without an error field', async () => {
    const app = appWith((c) => c.json({ ok: true }, 200))
    await app.request('/x')
    const f = parseLine(lines[0])
    expect(f.status).toBe('200')
    expect(f.error).toBeUndefined()
    expect(f.reason).toBeUndefined()
  })

  it('logs reason + message for an inline apiError', async () => {
    const app = appWith((c) => apiError(c, 404, 'Widget not found'))
    const res = await app.request('/x')
    expect(res.status).toBe(404)
    const f = parseLine(lines[0])
    expect(f.status).toBe('404')
    expect(f.reason).toBe('NOT_FOUND')
    expect(f.error).toBe('Widget not found')
  })

  it('carries the specific reason + metadata message for a special error', async () => {
    const app = appWith((c) =>
      apiError(c, 402, 'Insufficient credits', {
        reason: ErrorReason.INSUFFICIENT_CREDITS,
        metadata: { resource: 'storage_egress' },
      }),
    )
    await app.request('/x')
    const f = parseLine(lines[0])
    expect(f.reason).toBe('INSUFFICIENT_CREDITS')
    expect(f.error).toBe('Insufficient credits')
  })

  it('logs a thrown domain error with its MAPPED status, not 500', async () => {
    const app = appWith(() => {
      throw new NameConflictError('doc.txt', 'id-1')
    })
    const res = await app.request('/x')
    expect(res.status).toBe(409)
    const f = parseLine(lines[0])
    expect(f.status).toBe('409')
    expect(f.reason).toBe('NAME_CONFLICT')
  })

  it('logs the full cause chain for an unhandled 500 (and hides it from the client)', async () => {
    const app = appWith(() => {
      const err = new Error('top') as Error & { cause?: unknown }
      err.cause = new Error('D1_ERROR: disk full')
      throw err
    })
    const res = await app.request('/x')
    expect(res.status).toBe(500)
    // Client body is generic — no internal detail leaks.
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('Internal Server Error')
    // The access log keeps the full chain.
    const f = parseLine(lines[0])
    expect(f.status).toBe('500')
    expect(f.reason).toBe('INTERNAL')
    expect(f.error).toContain('top')
    expect(f.error).toContain('D1_ERROR: disk full')
  })
})
