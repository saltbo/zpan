import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuth } from '../auth.js'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'
import { JWKS_DECRYPT_FAILED_EVENT } from './jwks-decrypt-monitor.js'

const LEGACY = 'legacy-secret-that-is-at-least-32-characters'
const V1 = 'version-one-secret-that-is-at-least-32-chars'
const V2 = 'version-two-secret-that-is-at-least-32-chars'
const ORIGIN = 'http://localhost:3000'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('JWKS decrypt failure detection', () => {
  it('logs one event naming the undecryptable row and leaves the failing response unchanged', async () => {
    const ctx = await createTestApp()
    // A deployment on version 1 creates the signing key.
    const writer = await createAuth(ctx.db, { secret: LEGACY, secrets: [{ version: 1, value: V1 }] }, ORIGIN)
    await writer.api.signJWT({ body: { payload: { sub: 'seed' } } })
    const [stored] = await ctx.db.select().from(authSchema.jwks)

    // Another deployment sharing the database no longer lists version 1.
    const tasks: Promise<unknown>[] = []
    const reader = await createAuth(
      ctx.db,
      { secret: LEGACY, secrets: [{ version: 2, value: V2 }] },
      ORIGIN,
      [ORIGIN],
      (task) => tasks.push(task),
    )
    const signUp = await reader.handler(
      new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ name: 'Jwks User', email: 'jwks@example.com', password: 'password123456' }),
      }),
    )
    expect(signUp.status).toBe(200)
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const requestToken = () => reader.handler(new Request(`${ORIGIN}/api/auth/token`, { headers: { cookie } }))

    const first = await requestToken()
    expect(first.status).toBe(500)
    await Promise.all(tasks)
    const second = await requestToken()
    expect(second.status).toBe(500)
    await Promise.all(tasks)

    const events = errors.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.startsWith(JWKS_DECRYPT_FAILED_EVENT))
    expect(events).toHaveLength(1)
    expect(events[0]).toContain(`"id":"${stored.id}"`)
    expect(events[0]).toContain('"encryptedWith":"v1"')
    expect(events[0]).toContain('"reason":"version_not_configured"')
    expect(events[0]).toContain('configured_versions=[2]')
    // better-auth's own error line is still printed.
    expect(errors.mock.calls.some(([line]) => String(line).includes('[Better Auth]:'))).toBe(true)

    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).not.toContain(stored.privateKey)
    for (const secret of [LEGACY, V1, V2]) expect(logged).not.toContain(secret)
  })
})
