/**
 * Integration tests for the sign-up audit interceptor fail-fast invariants.
 *
 * The Hono interceptor in app.ts records sign_up / invite_code_redeem audit
 * events after a successful Better Auth sign-up response.
 *
 * Design: user.create.after (inside a.handler()) gathers audit data (orgId,
 * inviteCodeId) using auth._db while read-after-write consistency is
 * guaranteed, then stores it in auth._pendingSignupAudits. The interceptor
 * retrieves from the Map (no DB reads) and writes using fresh platform.db.
 *
 * Fail-fast: if audit data is missing or user.id is absent, the interceptor
 * throws before returning the auth response — the client gets 5xx instead of
 * a silent success with missing audit rows.
 *
 * These tests use a fake auth handler to isolate the interceptor's invariant
 * checks from Better Auth internals.
 */

import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Auth } from './auth'
import { createTestApp } from './test/setup'

function makeFakeAuth(responseBody: unknown, status = 200): Auth {
  return {
    handler: async () =>
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    api: {
      getSession: async () => null,
    },
  } as unknown as Auth
}

const SIGN_UP_URL = '/api/auth/sign-up/email'
const SIGN_UP_PAYLOAD = { name: 'Test User', email: 'test@example.com', password: 'password123456' }

describe('sign-up audit interceptor — fail-fast invariants', () => {
  it('returns 5xx when the auth response is missing user.id', async () => {
    // auth returns 200 but with no user.id — invariant: we cannot record who signed up
    const { platform } = await createTestApp()
    const app = createApp(platform, makeFakeAuth({ user: {} }))

    const res = await app.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SIGN_UP_PAYLOAD),
    })

    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('returns 5xx when no pending audit data exists for the userId (org missing or hook never ran)', async () => {
    // Fake auth returns a userId that was never processed by user.create.after,
    // so _pendingSignupAudits has no entry → interceptor throws → 5xx.
    // This covers the case where the personal org does not exist after sign-up
    // (user.create.after would throw before populating the Map) or the hook was
    // bypassed entirely.
    const { platform } = await createTestApp()
    const app = createApp(
      platform,
      makeFakeAuth({ user: { id: 'nonexistent-user-ghost', email: 'ghost@example.com' } }),
    )

    const res = await app.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SIGN_UP_PAYLOAD),
    })

    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
