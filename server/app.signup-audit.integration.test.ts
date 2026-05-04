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
 * These tests cover:
 * - Interceptor fail-fast: missing user.id or missing Map entry → 5xx
 * - INVITE_ONLY hook invariant: if user.create.after threw because the
 *   redeemed code row was missing, the Map entry is never populated — the
 *   "no pending audit data" test covers this exact scenario at the interceptor
 *   boundary (same observable outcome: Map miss → 5xx)
 * - INVITE_ONLY happy path: valid code → 200, both sign_up and
 *   invite_code_redeem rows written, raw code absent from every audit field
 */

import { desc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import type { Auth } from './auth'
import { activityEvents, systemOptions } from './db/schema'
import { generateInviteCodes } from './services/invite'
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

  it('returns 5xx when no pending audit data exists for the userId (org missing or hook threw)', async () => {
    // Fake auth returns a userId that was never processed by user.create.after,
    // so _pendingSignupAudits has no entry → interceptor throws → 5xx.
    //
    // This also covers the INVITE_ONLY invariant in user.create.after:
    // if mode===INVITE_ONLY && inviteCode present && no codeRow WHERE usedBy=userId,
    // user.create.after throws BEFORE calling pendingSignupAudits.set() —
    // the observable outcome at the interceptor boundary is the same empty Map → 5xx.
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

describe('sign-up audit — INVITE_ONLY happy path', () => {
  it('records sign_up and invite_code_redeem with no raw invite code after successful invite-only sign-up', async () => {
    const { app, db } = await createTestApp()

    // Bootstrap: first user (admin)
    await app.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: 'admin@example.com', password: 'password123456' }),
    })

    // Set invite_only mode and generate a valid code
    await db.insert(systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    const [codeRow] = await generateInviteCodes(db, 'admin-1', 1)
    const rawCode = codeRow.code

    // Sign up second user with the invite code
    const res = await app.request(SIGN_UP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invited User',
        email: 'invited@example.com',
        password: 'password123456',
        inviteCode: rawCode,
      }),
    })
    expect(res.status).toBe(200)

    // Both audit rows must exist
    const rows = await db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt))
    const actions = rows.map((r) => r.action)
    expect(actions).toContain('sign_up')
    expect(actions).toContain('invite_code_redeem')

    // The raw invite code must not appear in any audit field
    for (const row of rows) {
      expect(row.targetId).not.toBe(rawCode)
      expect(row.targetName).not.toBe(rawCode)
      if (row.metadata) expect(row.metadata).not.toContain(rawCode)
    }

    // invite_code_redeem row stores the safe row id, not the raw code
    const redeemRow = rows.find((r) => r.action === 'invite_code_redeem')
    expect(redeemRow?.targetId).toBe(codeRow.id)
    expect(redeemRow?.targetName).toBe('invite code')
  })
})
