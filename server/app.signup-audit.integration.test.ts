/**
 * Integration tests for the sign-up audit interceptor fail-fast invariants.
 *
 * The Hono interceptor in app.ts records sign_up / invite_code_redeem audit
 * events after a successful Better Auth sign-up response. If any audit
 * invariant is violated the interceptor throws, Hono converts the throw to a
 * 500, and the successful auth response is NOT forwarded to the client.
 *
 * These tests inject a fake auth handler that returns a controlled 200 so we
 * can exercise the three invariant throw paths without depending on Better
 * Auth internals.
 */

import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Auth } from './auth'
import { systemOptions } from './db/schema'
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

  it('returns 5xx when personal org is not found after successful sign-up', async () => {
    // auth returns a user id that has no corresponding org in the DB
    // invariant: a sign-up must always result in a personal org (created by session.create.before)
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

  it('returns 5xx when inviteCode is present in INVITE_ONLY mode but no redeemed code row exists', async () => {
    // Sign up a real user so the personal org exists in the DB.
    const { app: realApp, platform, db } = await createTestApp()
    const signUpRes = await realApp.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Real User', email: 'real@example.com', password: 'password123456' }),
    })
    expect(signUpRes.status).toBe(200)
    const { user } = (await signUpRes.json()) as { user: { id: string } }
    const userId = user.id

    // Set INVITE_ONLY mode.
    await db.insert(systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })

    // Fake auth returns the real user's id — the interceptor will find the personal org,
    // then check the invite code invariant: inviteCode present + INVITE_ONLY mode +
    // no invite_codes row with usedBy = userId → throw → 500.
    const fakeApp = createApp(platform, makeFakeAuth({ user: { id: userId, email: 'real@example.com' } }))

    const res = await fakeApp.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...SIGN_UP_PAYLOAD, inviteCode: 'unredeemed-code-abc' }),
    })

    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
