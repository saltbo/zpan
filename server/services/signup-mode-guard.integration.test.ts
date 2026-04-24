import { describe, expect, it } from 'vitest'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import { generateInviteCodes } from './invite.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>

async function signUp(ctx: TestCtx, email: string, extra?: Record<string, unknown>) {
  return ctx.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456', ...extra }),
  })
}

async function seedProLicense(ctx: TestCtx, features: string[] = ['open_registration']) {
  const cert = JSON.stringify({
    account_id: 'test-account',
    instance_id: 'test-instance',
    plan: 'pro',
    features,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400 * 1000).toISOString(),
  })
  await ctx.db.insert(schema.licenseBinding).values({
    id: 1,
    instanceId: 'test-instance',
    refreshToken: 'test-refresh-token',
    cachedCert: cert,
  })
}

async function seedFirstUser(ctx: TestCtx) {
  await signUp(ctx, 'admin@example.com')
}

// ─── open mode × Pro ─────────────────────────────────────────────────────────

describe('open mode (Pro instance)', () => {
  it('second user can register without invite code', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(200)
  })

  it('third user can also register without invite code', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await seedFirstUser(ctx)
    await signUp(ctx, 'second@example.com')
    const res = await signUp(ctx, 'third@example.com')
    expect(res.status).toBe(200)
  })
})

// ─── open mode × non-Pro (retroactive gate) ──────────────────────────────────

describe('open mode (non-Pro instance) — retroactive gate', () => {
  it('second user is rejected when stored mode is open but instance has no Pro license', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).not.toBe(200)
  })

  it('rejection returns 422 (same as invite_only behaviour)', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(422)
  })

  it('second user can register when a valid invite code is supplied (falls back to invite-only)', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await seedFirstUser(ctx)
    const [codeRow] = await generateInviteCodes(ctx.db, 'admin-1', 1)
    const res = await signUp(ctx, 'invited@example.com', { inviteCode: codeRow.code })
    expect(res.status).toBe(200)
  })
})

// ─── invite_only mode × Pro ──────────────────────────────────────────────────

describe('invite_only mode (Pro instance)', () => {
  it('second user is rejected without invite code', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'noinvite@example.com')
    expect(res.status).not.toBe(200)
  })

  it('second user can register with valid invite code', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await seedFirstUser(ctx)
    const [codeRow] = await generateInviteCodes(ctx.db, 'admin-1', 1)
    const res = await signUp(ctx, 'invited@example.com', { inviteCode: codeRow.code })
    expect(res.status).toBe(200)
  })
})

// ─── invite_only mode × non-Pro ──────────────────────────────────────────────

describe('invite_only mode (non-Pro instance)', () => {
  it('second user is rejected without invite code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'noinvite@example.com')
    expect(res.status).not.toBe(200)
  })

  it('second user can register with valid invite code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await seedFirstUser(ctx)
    const [codeRow] = await generateInviteCodes(ctx.db, 'admin-1', 1)
    const res = await signUp(ctx, 'invited@example.com', { inviteCode: codeRow.code })
    expect(res.status).toBe(200)
  })
})

// ─── closed mode × Pro ───────────────────────────────────────────────────────

describe('closed mode (Pro instance)', () => {
  it('second user is rejected', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).not.toBe(200)
  })
})

// ─── closed mode × non-Pro ───────────────────────────────────────────────────

describe('closed mode (non-Pro instance)', () => {
  it('second user is rejected', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await seedFirstUser(ctx)
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).not.toBe(200)
  })
})

// ─── PUT /api/system/options/auth_signup_mode ─────────────────────────────────

describe('PUT auth_signup_mode via admin API', () => {
  async function adminHeaders(ctx: TestCtx) {
    await signUp(ctx, 'admin@example.com')
    const signInRes = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
    })
    return { Cookie: signInRes.headers.getSetCookie().join('; ') }
  }

  async function putSignupMode(ctx: TestCtx, headers: Record<string, string>, value: string) {
    return ctx.app.request('/api/system/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, public: true }),
    })
  }

  it('setting open without Pro returns 402', async () => {
    const ctx = await createTestApp()
    const headers = await adminHeaders(ctx)
    const res = await putSignupMode(ctx, headers, 'open')
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: string; feature: string }
    expect(body.error).toBe('feature_not_available')
    expect(body.feature).toBe('open_registration')
  })

  it('setting open with Pro succeeds', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    const headers = await adminHeaders(ctx)
    const res = await putSignupMode(ctx, headers, 'open')
    expect(res.status).toBe(201)
  })

  it('setting invite_only without Pro succeeds', async () => {
    const ctx = await createTestApp()
    const headers = await adminHeaders(ctx)
    const res = await putSignupMode(ctx, headers, 'invite_only')
    expect(res.status).toBe(201)
  })

  it('setting closed without Pro succeeds', async () => {
    const ctx = await createTestApp()
    const headers = await adminHeaders(ctx)
    const res = await putSignupMode(ctx, headers, 'closed')
    expect(res.status).toBe(201)
  })

  it('setting invite_only with Pro succeeds', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx)
    const headers = await adminHeaders(ctx)
    const res = await putSignupMode(ctx, headers, 'invite_only')
    expect(res.status).toBe(201)
  })
})
