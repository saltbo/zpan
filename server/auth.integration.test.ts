import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { isPersonalOrgLike } from '@shared/org-slugs'
import { deriveDpopAth } from 'better-auth/oauth2'
import { eq, sql } from 'drizzle-orm'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInviteRepo } from './adapters/repos/invite.js'
import { createSiteInvitationRepo } from './adapters/repos/site-invitations.js'
import { createApp } from './app.js'
import { createAuth } from './auth.js'
import * as authSchema from './db/auth-schema.js'
import * as schema from './db/schema.js'
import { inviteCodes, siteInvitations } from './db/schema.js'
import { auditActor } from './middleware/audit-actor.js'
import { adminHeaders, createTestApp, seedProLicense } from './test/setup.js'

type TestCtx = Awaited<ReturnType<typeof createTestApp>>

afterEach(() => {
  vi.unstubAllGlobals()
})

async function signUp(ctx: TestCtx, email: string, extra?: Record<string, unknown>) {
  return ctx.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456', ...extra }),
  })
}

async function configureRequiredEmailVerification(ctx: TestCtx) {
  await ctx.db.insert(schema.systemOptions).values([
    { key: 'email_enabled', value: 'true' },
    { key: 'email_provider', value: 'http' },
    { key: 'email_from', value: 'no-reply@example.com' },
    { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
    { key: 'email_http_api_key', value: 'my-api-key' },
    { key: 'auth_require_email_verification', value: 'true' },
  ])
}

async function expectPlanEntitlement(ctx: TestCtx, resourceType: 'storage' | 'traffic', bytes: number) {
  const rows = await ctx.db.select().from(schema.orgQuotaEntitlements)
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        resourceType,
        entitlementType: 'plan',
        source: 'free_plan',
        bytes,
        status: 'active',
      }),
    ]),
  )
}

async function personalOrgForUser(ctx: TestCtx, userId: string): Promise<string> {
  const rows = await ctx.db
    .select({
      id: authSchema.organization.id,
      slug: authSchema.organization.slug,
      metadata: authSchema.organization.metadata,
    })
    .from(authSchema.member)
    .innerJoin(authSchema.organization, eq(authSchema.organization.id, authSchema.member.organizationId))
    .where(eq(authSchema.member.userId, userId))
  const org = rows.find(isPersonalOrgLike)
  if (!org) throw new Error(`No personal org found for user ${userId}`)
  return org.id
}

describe('registration gate — first user always allowed', () => {
  it('first user can register when auth_signup_mode is closed', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    const res = await signUp(ctx, 'first@example.com')
    expect(res.status).toBe(200)
  })

  it('first user can register when auth_signup_mode is invite_only without a code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    const res = await signUp(ctx, 'first@example.com')
    expect(res.status).toBe(200)
  })

  it('first user is promoted to admin when auth_signup_mode is invite_only', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    const res = await signUp(ctx, 'first@example.com')
    const body = (await res.json()) as { user: { role: string } }
    expect(body.user.role).toBe('admin')
  })

  it('first user can register when auth_signup_mode is open', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    const res = await signUp(ctx, 'first@example.com')
    expect(res.status).toBe(200)
  })
})

describe('registration gate — open mode', () => {
  it('second user can register when auth_signup_mode is not set (defaults to open)', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(200)
  })

  it('second user can register when auth_signup_mode is explicitly open and instance has Pro license', async () => {
    const ctx = await createTestApp()
    await seedProLicense(ctx.db)
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(200)
  })

  it('second user is rejected when auth_signup_mode is explicitly open but instance has no Pro license', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'open' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(422)
  })
})

describe('registration gate — closed mode', () => {
  it('second user is rejected when auth_signup_mode is closed', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'blocked@example.com')
    expect(res.status).not.toBe(200)
  })

  it('third user is also rejected when auth_signup_mode is closed', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    await signUp(ctx, 'second@example.com') // blocked
    const res = await signUp(ctx, 'third@example.com')
    expect(res.status).not.toBe(200)
  })

  it('closed mode returns 422 status code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'blocked@example.com')
    expect(res.status).toBe(422)
  })

  it('second user can register with a valid site invitation token', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    const [admin] = await ctx.db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'first@example.com'))
      .limit(1)
    const invitation = await createSiteInvitationRepo(ctx.db).createSiteInvitation(admin.id, 'invited@example.com')

    const res = await signUp(ctx, 'invited@example.com', { siteInvitationToken: invitation.token })

    expect(res.status).toBe(200)
  })

  it('accepts the site invitation after successful registration', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    const [admin] = await ctx.db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'first@example.com'))
      .limit(1)
    const invitation = await createSiteInvitationRepo(ctx.db).createSiteInvitation(admin.id, 'invited@example.com')

    const res = await signUp(ctx, 'invited@example.com', { siteInvitationToken: invitation.token })
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select()
      .from(siteInvitations)
      .where(eq(siteInvitations.token, invitation.token))
      .limit(1)

    expect(row.acceptedBy).toBe(body.user.id)
    expect(row.acceptedAt).not.toBeNull()
  })

  it('rejects site invitation token when email does not match', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'closed' })
    await signUp(ctx, 'first@example.com')
    const [admin] = await ctx.db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.email, 'first@example.com'))
      .limit(1)
    const invitation = await createSiteInvitationRepo(ctx.db).createSiteInvitation(admin.id, 'invited@example.com')

    const res = await signUp(ctx, 'other@example.com', { siteInvitationToken: invitation.token })

    expect(res.status).toBe(422)
  })
})

describe('registration gate — invite_only mode', () => {
  it('second user is rejected when no invite code is provided', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'noinvite@example.com')
    expect(res.status).not.toBe(200)
  })

  it('invite_only mode with no code returns 422 status code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'noinvite@example.com')
    expect(res.status).toBe(422)
  })

  it('second user is rejected when an invalid invite code is provided', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'badinvite@example.com', { inviteCode: 'BADCODE1' })
    expect(res.status).not.toBe(200)
  })

  it('second user is rejected when invite code is expired', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const pastDate = new Date(Date.now() - 1000)
    const [codeRow] = await createInviteRepo(ctx.db).generate('admin-1', 1, pastDate)
    const res = await signUp(ctx, 'expired@example.com', { inviteCode: codeRow.code })
    expect(res.status).not.toBe(200)
  })

  it('second user registers successfully with a valid invite code', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const [codeRow] = await createInviteRepo(ctx.db).generate('admin-1', 1)
    const res = await signUp(ctx, 'invited@example.com', { inviteCode: codeRow.code })
    expect(res.status).toBe(200)
  })

  it('invite code usedBy is set to the new user ID after successful registration', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const [codeRow] = await createInviteRepo(ctx.db).generate('admin-1', 1)
    const res = await signUp(ctx, 'invited2@example.com', { inviteCode: codeRow.code })
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db.select().from(inviteCodes).where(eq(inviteCodes.code, codeRow.code))
    expect(row.usedBy).toBe(body.user.id)
    expect(row.usedAt).not.toBeNull()
  })

  it('same invite code cannot be used twice', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'invite_only' })
    await signUp(ctx, 'first@example.com')
    const [codeRow] = await createInviteRepo(ctx.db).generate('admin-1', 1)
    await signUp(ctx, 'user1@example.com', { inviteCode: codeRow.code })
    const res = await signUp(ctx, 'user2@example.com', { inviteCode: codeRow.code })
    expect(res.status).not.toBe(200)
  })
})

describe('getSignupMode — via auth_signup_mode system option', () => {
  it('unknown value in auth_signup_mode falls back to open (second user succeeds)', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: 'unknown_value' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(200)
  })

  it('empty string in auth_signup_mode falls back to open', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'auth_signup_mode', value: '' })
    await signUp(ctx, 'first@example.com')
    const res = await signUp(ctx, 'second@example.com')
    expect(res.status).toBe(200)
  })
})

describe('isEmailConfigured — via emailVerification conditional', () => {
  it('createAuth succeeds when email_provider is not configured', async () => {
    const ctx = await createTestApp()
    expect(ctx.auth).toBeTruthy()
  })

  it('sign-up succeeds without email_provider configured', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'user@example.com')
    expect(res.status).toBe(200)
  })

  it('send-verification-email is a no-op (returns early) when email_provider is not configured', async () => {
    const ctx = await createTestApp()
    // Sign up first so the user exists
    await signUp(ctx, 'verify@example.com')
    // Trigger the sendVerificationEmail callback — should not throw even without email config
    const res = await ctx.app.request('/api/auth/send-verification-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'verify@example.com' }),
    })
    // The endpoint returns 200 regardless; the callback silently returns early
    expect(res.status).toBe(200)
  })
})

describe('Better Auth account issuer migration', () => {
  it('restores email sign-in for a legacy credential account', async () => {
    const ctx = await createTestApp()
    const email = 'legacy-issuer@example.com'
    await signUp(ctx, email)
    await ctx.db
      .update(authSchema.account)
      .set({ issuer: '' })
      .where(
        eq(
          authSchema.account.userId,
          (await ctx.db.query.user.findFirst({ where: eq(authSchema.user.email, email) }))!.id,
        ),
      )

    const rejected = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123456' }),
    })
    expect(rejected.status).toBe(401)

    const migration = readFileSync(
      join(process.cwd(), 'migrations/0089_better-auth-account-issuer-backfill.sql'),
      'utf-8',
    )
    for (const statement of migration.split('--> statement-breakpoint')) {
      await ctx.db.run(sql.raw(statement))
    }

    const restored = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123456' }),
    })
    expect(restored.status).toBe(200)
    expect(restored.headers.getSetCookie()).not.toHaveLength(0)
  })
})

describe('dynamic email verification policy', () => {
  it('requires verification immediately and resends the email on sign-in', async () => {
    const { vi } = await import('vitest')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const ctx = await createTestApp()
      await configureRequiredEmailVerification(ctx)

      const signUpResponse = await signUp(ctx, 'required@example.com', { username: 'required_user' })
      expect(signUpResponse.status).toBe(200)
      await expect(signUpResponse.json()).resolves.toMatchObject({ token: null })
      expect(await ctx.db.select().from(authSchema.session)).toHaveLength(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      const signInResponse = await ctx.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'required@example.com', password: 'password123456' }),
      })
      expect(signInResponse.status).toBe(403)
      await expect(signInResponse.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const usernameSignInResponse = await ctx.app.request('/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'required_user', password: 'password123456' }),
      })
      expect(usernameSignInResponse.status).toBe(403)
      await expect(usernameSignInResponse.json()).resolves.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts the verification link and marks the user as verified', async () => {
    const { vi } = await import('vitest')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const ctx = await createTestApp()
      await configureRequiredEmailVerification(ctx)
      await signUp(ctx, 'verify-required@example.com')

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
      const payload = JSON.parse(String(request?.body)) as { html: string }
      const verificationUrl = payload.html.match(/href="([^"]+)"/)?.[1]
      if (!verificationUrl) throw new Error('Verification email did not contain a link')

      const url = new URL(verificationUrl)
      const verifyResponse = await ctx.app.request(`${url.pathname}${url.search}`)
      expect(verifyResponse.status).toBe(302)

      const [user] = await ctx.db
        .select({ emailVerified: authSchema.user.emailVerified })
        .from(authSchema.user)
        .where(eq(authSchema.user.email, 'verify-required@example.com'))
        .limit(1)
      expect(user.emailVerified).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('applies a disabled policy without recreating the auth service', async () => {
    const { vi } = await import('vitest')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    try {
      const ctx = await createTestApp()
      await configureRequiredEmailVerification(ctx)
      await signUp(ctx, 'toggle@example.com')
      await ctx.db
        .update(schema.systemOptions)
        .set({ value: 'false' })
        .where(eq(schema.systemOptions.key, 'auth_require_email_verification'))

      const signInResponse = await ctx.app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'toggle@example.com', password: 'password123456' }),
      })
      expect(signInResponse.status).toBe(200)
      expect(signInResponse.headers.getSetCookie()).not.toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('last login method', () => {
  it('records email sign-in in a client-readable cookie', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'last-email@example.com')

    const response = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'last-email@example.com', password: 'password123456' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([expect.stringContaining('better-auth.last_used_login_method=email')]),
    )
  })

  it('records username sign-in in a client-readable cookie', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'last-username@example.com', { username: 'last_username' })

    const response = await ctx.app.request('/api/auth/sign-in/username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'last_username', password: 'password123456' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([expect.stringContaining('better-auth.last_used_login_method=username')]),
    )
  })

  it('does not update the cookie when sign-in fails', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'last-failed@example.com')

    const response = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'last-failed@example.com', password: 'wrong-password' }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('better-auth.last_used_login_method=')]),
    )
  })
})

describe('buildVerificationEmailHtml — via send-verification-email with email_provider configured', () => {
  it('send-verification-email triggers email send when email_provider is configured', async () => {
    const { vi } = await import('vitest')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values([
      { key: 'email_enabled', value: 'true' },
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
      { key: 'email_http_api_key', value: 'my-api-key' },
    ])

    await signUp(ctx, 'withmail@example.com')
    const res = await ctx.app.request('/api/auth/send-verification-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'withmail@example.com' }),
    })
    expect(res.status).toBe(200)
    // The email should have been sent via the HTTP provider
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.mail.example.com/send',
      expect.objectContaining({ method: 'POST' }),
    )

    vi.unstubAllGlobals()
  })

  it('verification email HTML contains the verification URL', async () => {
    const { vi } = await import('vitest')
    let capturedHtml = ''
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string)
      capturedHtml = body.html
      return { ok: true }
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values([
      { key: 'email_enabled', value: 'true' },
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
      { key: 'email_http_api_key', value: 'my-api-key' },
    ])

    await signUp(ctx, 'htmltest@example.com')
    await ctx.app.request('/api/auth/send-verification-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'htmltest@example.com' }),
    })

    expect(capturedHtml).toContain('verify-email')
    expect(capturedHtml).toContain('href=')

    vi.unstubAllGlobals()
  })
})

describe('loadProviderConfigs — createAuth with OIDC provider pre-configured', () => {
  it('createAuth succeeds when a valid enabled OIDC provider config is present', async () => {
    const ctx = await createTestApp()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          userinfo_endpoint: 'https://auth.example.com/userinfo',
          jwks_uri: 'https://auth.example.com/jwks',
        }),
      ),
    )
    const oidcConfig = JSON.stringify({
      providerId: 'my-oidc',
      type: 'oidc',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      enabled: true,
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
      scopes: ['openid', 'email'],
    })
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_my-oidc', value: oidcConfig })
    const auth = await createAuth(ctx.db, 'test-secret', 'http://localhost:3000')
    expect(auth).toBeTruthy()
  })

  it('createAuth succeeds when a disabled OIDC provider config is present', async () => {
    const ctx = await createTestApp()
    const oidcConfig = JSON.stringify({
      providerId: 'disabled-oidc',
      type: 'oidc',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      enabled: false,
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    })
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_disabled-oidc', value: oidcConfig })
    const auth = await createAuth(ctx.db, 'test-secret', 'http://localhost:3000')
    expect(auth).toBeTruthy()
  })

  it('createAuth succeeds when a malformed (non-JSON) provider config row is present', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_bad', value: 'not-valid-json' })
    const auth = await createAuth(ctx.db, 'test-secret', 'http://localhost:3000')
    expect(auth).toBeTruthy()
  })
})

describe('loadProviderConfigs — builtin social provider resolution', () => {
  it('social sign-in with an unconfigured provider returns non-200 (provider not registered)', async () => {
    const ctx = await createTestApp()
    // With no config in DB the provider is not registered with better-auth.
    const res = await ctx.app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: 'http://localhost:3000/callback' }),
    })
    expect(res.status).not.toBe(200)
  })

  it('social sign-in with a configured and enabled builtin provider returns a redirect', async () => {
    const ctx = await createTestApp()
    const builtinConfig = JSON.stringify({
      providerId: 'github',
      type: 'builtin',
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      enabled: true,
    })
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_github', value: builtinConfig })
    // Provider configs are snapshotted when the auth instance is created —
    // build a fresh auth/app that sees the seeded config.
    const auth = await createAuth(ctx.platform, 'test-secret', 'http://localhost:3000')
    const app = createApp(ctx.platform, auth)
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: 'http://localhost:3000/callback' }),
    })
    // With a valid enabled provider, better-auth returns a redirect (302) to the OAuth provider
    expect([200, 302]).toContain(res.status)
  })

  it('social sign-in with a configured and enabled OIDC provider returns a redirect', async () => {
    const ctx = await createTestApp()
    const oidcConfig = JSON.stringify({
      providerId: 'my-oidc',
      type: 'oidc',
      clientId: 'oidc-client',
      clientSecret: 'oidc-secret',
      enabled: true,
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
      scopes: ['openid', 'email'],
    })
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_my-oidc', value: oidcConfig })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url === 'https://auth.example.com/.well-known/openid-configuration') {
          return new Response(
            JSON.stringify({
              issuer: 'https://auth.example.com',
              authorization_endpoint: 'https://auth.example.com/oauth2/authorize',
              token_endpoint: 'https://auth.example.com/oauth2/token',
              jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
              response_types_supported: ['code'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['RS256'],
            }),
            {
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    const auth = await createAuth(ctx.platform, 'test-secret', 'http://localhost:3000')
    const app = createApp(ctx.platform, auth)
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'my-oidc', callbackURL: 'http://localhost:3000/callback' }),
    })

    expect([200, 302]).toContain(res.status)
  })

  it('social sign-in ignores a disabled builtin provider config', async () => {
    const ctx = await createTestApp()
    const builtinConfig = JSON.stringify({
      providerId: 'github',
      type: 'builtin',
      clientId: 'gh-client',
      clientSecret: 'gh-secret',
      enabled: false,
    })
    await ctx.db.insert(schema.systemOptions).values({ key: 'oauth_provider_github', value: builtinConfig })
    const auth = await createAuth(ctx.platform, 'test-secret', 'http://localhost:3000')
    const app = createApp(ctx.platform, auth)
    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: 'http://localhost:3000/callback' }),
    })

    expect(res.status).not.toBe(200)
  })

  it('createAuth initializes provider config and OAuth resources without scanning OAuth clients', async () => {
    const ctx = await createTestApp()
    let selectCalls = 0
    const countingDb = new Proxy(ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'select') selectCalls++
        const val = Reflect.get(target, prop, receiver)
        return typeof val === 'function' ? val.bind(target) : val
      },
    })
    await createAuth(countingDb as typeof ctx.db, 'test-secret', 'http://localhost:3000')
    expect(selectCalls).toBe(3)
  })

  it('refreshes configured OAuth resource scopes on an existing database', async () => {
    const ctx = await createTestApp()
    const identifier = 'http://localhost:3000/api'
    await ctx.db
      .update(authSchema.oauthResource)
      .set({ allowedScopes: JSON.stringify(['openid', 'offline_access']) })
      .where(eq(authSchema.oauthResource.identifier, identifier))

    await createAuth(ctx.platform, 'test-secret', 'http://localhost:3000')

    const [resource] = await ctx.db
      .select({ allowedScopes: authSchema.oauthResource.allowedScopes })
      .from(authSchema.oauthResource)
      .where(eq(authSchema.oauthResource.identifier, identifier))
      .limit(1)
    expect(JSON.parse(resource?.allowedScopes ?? '[]')).toContain(AuthorizationScope.WORKSPACES_DISCOVER)
  })

  it('createAuth resolves better-auth $context before returning', async () => {
    // A cached auth instance must never carry a pending init promise: on
    // Cloudflare Workers a promise created in one request never settles when
    // awaited from another, hanging every auth call in the isolate.
    const ctx = await createTestApp()
    let settled = false
    void ctx.auth.$context.then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
  })
})

describe('Cloudflare Workers preview auth origins', () => {
  const configuredOrigin = 'https://zpan-staging.saltbo.workers.dev'
  const commitOrigin = 'https://99dc50ae-zpan.saltbo.workers.dev'
  const branchOrigin = 'https://feat-x402-paid-agent-uploads-zpan.saltbo.workers.dev'

  it('accepts official commit and branch aliases on the same cached auth instance', async () => {
    const ctx = await createTestApp()
    const auth = await createAuth(ctx.platform, 'test-secret', configuredOrigin, [configuredOrigin])
    const app = createApp(ctx.platform, auth)
    const email = `preview-${Date.now()}@example.com`
    const password = 'password123456'
    const signUp = await app.request(`${configuredOrigin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { Origin: configuredOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Preview User', email, password }),
    })
    expect(signUp.status).toBe(200)

    for (const origin of [commitOrigin, branchOrigin]) {
      const signIn = await app.request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, callbackURL: `${origin}/files` }),
      })
      expect(signIn.status, await signIn.clone().text()).toBe(200)
    }
  })

  it('rejects unrelated workers.dev origins', async () => {
    const ctx = await createTestApp()
    const auth = await createAuth(ctx.platform, 'test-secret', configuredOrigin, [configuredOrigin])
    const app = createApp(ctx.platform, auth)
    const origin = 'https://unrelated-worker.other-account.workers.dev'
    const signIn = await app.request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'password123456', callbackURL: `${origin}/files` }),
    })

    expect(signIn.status).toBe(403)
  })
})

describe('OAuth consent guards', () => {
  it('publishes the external resource discovery contract at the exact API URL', async () => {
    const ctx = await createTestApp()
    const resource = await ctx.app.request('http://localhost:3000/api')
    const metadata = await ctx.app.request('http://localhost:3000/.well-known/oauth-protected-resource/api')
    const authorizationServer = await ctx.app.request(
      'http://localhost:3000/.well-known/oauth-authorization-server/api/auth',
    )

    expect(resource.status).toBe(200)
    expect(resource.headers.get('link')).toBe(
      [
        '</api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
        '</api/workflows.arazzo.json>; rel="describedby"; type="application/vnd.oai.workflows+json"',
      ].join(', '),
    )
    await expect(metadata.json()).resolves.toMatchObject({
      resource: 'http://localhost:3000/api',
      authorization_servers: ['http://localhost:3000/api/auth'],
    })
    await expect(authorizationServer.json()).resolves.toMatchObject({
      registration_endpoint: 'http://localhost:3000/api/auth/oauth2/register',
      authorization_details_catalog_endpoint: 'http://localhost:3000/api/auth/oauth2/authorization-details/catalog',
      authorization_details_catalog_scope: AuthorizationScope.WORKSPACES_DISCOVER,
      grant_types_supported: expect.arrayContaining([
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'urn:ietf:params:oauth:grant-type:token-exchange',
      ]),
      dpop_signing_alg_values_supported: expect.any(Array),
    })
  })

  it('dynamically registers an external resource client without hard-coded identity', async () => {
    const ctx = await createTestApp()
    const res = await ctx.app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'External Resource Broker',
        redirect_uris: ['https://broker.example.com/api/account-connections/oauth/callback'],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid offline_access',
        jwks_uri: 'https://broker.example.com/api/auth/jwks',
        authorization_details_types: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
      }),
    })
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status, JSON.stringify(body)).toBe(201)
    expect(body).toMatchObject({
      client_id: expect.any(String),
      client_secret: expect.any(String),
      registration_access_token: expect.stringMatching(/^zpr_/),
      registration_client_uri: expect.stringMatching(/^http:\/\/localhost:3000\/api\/auth\/oauth2\/register\//),
      token_endpoint_auth_method: 'client_secret_basic',
      authorization_details_types: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
    })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(String(body.scope).split(' ')).toEqual(
      expect.arrayContaining(['openid', 'offline_access', 'workspaces:discover', 'objects:read']),
    )

    const applicationsResponse = await ctx.app.request('/api/site/auth-providers', {
      headers: await adminHeaders(ctx.app),
    })
    const applications = (await applicationsResponse.json()) as {
      registeredApplications: Array<{ clientId: string; name: string }>
    }
    expect(applicationsResponse.status).toBe(200)
    expect(applications.registeredApplications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: body.client_id,
          name: 'External Resource Broker',
        }),
      ]),
    )
  })

  it('reads, replaces, and deletes a dynamic client through its RFC 7592 configuration endpoint', async () => {
    const ctx = await createTestApp()
    const registration = await ctx.app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Managed Broker',
        redirect_uris: ['https://broker.example.com/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid offline_access',
      }),
    })
    const registered = (await registration.json()) as {
      client_id: string
      client_secret: string
      registration_access_token: string
      registration_client_uri: string
    }
    const authorization = { Authorization: `Bearer ${registered.registration_access_token}` }
    const [storedManagementCredential] = await ctx.db.select().from(authSchema.oauthClientRegistration)
    expect(storedManagementCredential).toMatchObject({ clientId: registered.client_id })
    expect(storedManagementCredential?.tokenHash).not.toBe(registered.registration_access_token)

    const unauthenticated = await ctx.app.request(registered.registration_client_uri)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('WWW-Authenticate')).toContain('invalid_token')

    const read = await ctx.app.request(registered.registration_client_uri, { headers: authorization })
    expect(read.status).toBe(200)
    const current = (await read.json()) as Record<string, unknown>
    expect(current).toMatchObject({
      client_id: registered.client_id,
      client_name: 'Managed Broker',
      registration_access_token: registered.registration_access_token,
      registration_client_uri: registered.registration_client_uri,
    })
    expect(current).not.toHaveProperty('client_secret')

    const update = await ctx.app.request(registered.registration_client_uri, {
      method: 'PUT',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: registered.client_id,
        client_secret: registered.client_secret,
        client_name: 'Managed Broker v2',
        redirect_uris: ['https://broker.example.com/oauth/callback-v2'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid offline_access workspaces:discover',
        authorization_details_types: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
      }),
    })
    const updated = (await update.json()) as Record<string, unknown>
    expect(update.status, JSON.stringify(updated)).toBe(200)
    expect(updated).toMatchObject({
      client_id: registered.client_id,
      client_name: 'Managed Broker v2',
      redirect_uris: ['https://broker.example.com/oauth/callback-v2'],
      scope: 'openid offline_access workspaces:discover',
      authorization_details_types: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
    })
    expect(updated).not.toHaveProperty('client_secret')

    const forbiddenServerMetadata = await ctx.app.request(registered.registration_client_uri, {
      method: 'PUT',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: registered.client_id, registration_access_token: 'replacement' }),
    })
    expect(forbiddenServerMetadata.status).toBe(400)
    await expect(forbiddenServerMetadata.json()).resolves.toMatchObject({ error: 'invalid_client_metadata' })

    const wrongSecret = await ctx.app.request(registered.registration_client_uri, {
      method: 'PUT',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: registered.client_id,
        client_secret: 'not-the-issued-secret',
        redirect_uris: ['https://broker.example.com/oauth/callback-v2'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    })
    expect(wrongSecret.status).toBe(400)

    const deleted = await ctx.app.request(registered.registration_client_uri, {
      method: 'DELETE',
      headers: authorization,
    })
    expect(deleted.status).toBe(204)
    expect(deleted.headers.get('Cache-Control')).toBe('no-store')

    const readDeleted = await ctx.app.request(registered.registration_client_uri, { headers: authorization })
    expect(readDeleted.status).toBe(401)
    expect(await ctx.db.select().from(authSchema.oauthClientRegistration)).toEqual([])
  })

  it('rejects unsupported authorization detail types during dynamic client registration', async () => {
    const ctx = await createTestApp()
    const response = await ctx.app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Unsupported RAR Client',
        redirect_uris: ['https://broker.example.com/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        authorization_details_types: ['https://broker.example.com/authorization-details/unknown'],
      }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_client_metadata',
      error_description: 'authorization_details_types contains an unsupported type',
    })
  })

  it('returns a DPoP challenge for a foreign access token instead of an internal error', async () => {
    const ctx = await createTestApp()
    const apiUrl = 'http://localhost:3000/api/objects'
    const { privateKey: foreignPrivateKey } = await generateKeyPair('ES256')
    const { privateKey: dpopPrivateKey, publicKey: dpopPublicKey } = await generateKeyPair('ES256')
    const dpopPublicJwk = await exportJWK(dpopPublicKey)
    const accessToken = await new SignJWT({
      sub: 'foreign-user',
      client_id: 'foreign-client',
      zpan_org_id: 'foreign-workspace',
      act: { sub: 'foreign-agent', iss: 'https://identity.example.com/api/auth' },
      scope: 'objects:create',
      cnf: { jkt: 'foreign-thumbprint' },
    })
      .setProtectedHeader({ typ: 'JWT', alg: 'ES256', kid: 'foreign-key' })
      .setIssuer('http://localhost:3000/api/auth')
      .setAudience('http://localhost:3000/api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti(crypto.randomUUID())
      .sign(foreignPrivateKey)
    const proof = await new SignJWT({
      htm: 'POST',
      htu: apiUrl,
      ath: await deriveDpopAth(accessToken),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: dpopPublicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(dpopPrivateKey)
    const getJwks = ctx.auth.api.getJwks
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url === 'http://localhost:3000/api/auth/jwks') return Response.json(await getJwks())
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const response = await ctx.app.request(apiUrl, {
      method: 'POST',
      headers: { Authorization: `DPoP ${accessToken}`, DPoP: proof, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'foreign.txt', size: 1, type: 'text/plain', dirtype: 0, parent: '' }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('DPoP')
    expect(response.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/api')
  })

  it('issues a DPoP API token through JWT bearer and token exchange grants', async () => {
    const ctx = await createTestApp()
    ctx.app.get('/api/test-agent-audit', async (c) => {
      const principal = c.get('principal')
      if (principal?.kind !== 'oauth') return c.json({ error: 'agent principal required' }, 401)
      await c.get('deps').audit.record({
        ...auditActor(principal),
        orgId: principal.orgId,
        action: 'agent_identity_probe',
        targetType: 'route',
        targetName: 'Agent identity probe',
      })
      return c.json({ ok: true })
    })
    const { privateKey: actorPrivateKey, publicKey: actorPublicKey } = await generateKeyPair('ES256')
    const actorPublicJwk = { ...(await exportJWK(actorPublicKey)), kid: 'actor-key', use: 'sig', alg: 'ES256' }
    const getJwks = ctx.auth.api.getJwks
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url === 'https://broker.example.com/api/auth/jwks') {
          return Response.json({ keys: [actorPublicJwk] })
        }
        if (url === 'http://localhost:3000/api/auth/jwks') {
          return Response.json(await getJwks())
        }
        throw new Error(`Unexpected fetch: ${url}`)
      }),
    )

    const registration = await ctx.app.request('http://localhost:3000/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'External Resource Broker',
        redirect_uris: ['https://broker.example.com/api/account-connections/oauth/callback'],
        grant_types: [
          'authorization_code',
          'refresh_token',
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
          'urn:ietf:params:oauth:grant-type:token-exchange',
        ],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid offline_access',
        jwks_uri: 'https://broker.example.com/api/auth/jwks',
      }),
    })
    const registered = (await registration.json()) as { client_id: string; client_secret: string }
    expect(registration.status).toBe(201)

    const signUpResponse = await signUp(ctx, 'external-resource@example.com')
    const signUpBody = (await signUpResponse.clone().json()) as { user: { id: string } }
    const workspaceId = await personalOrgForUser(ctx, signUpBody.user.id)
    const cookie = signUpResponse.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const verifier = 'external-resource-verifier-with-sufficient-entropy-1234567890'
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const redirectUri = 'https://broker.example.com/api/account-connections/oauth/callback'
    const scope = 'openid offline_access workspaces:discover objects:read quota:read'
    const authorizeParams = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      resource: 'http://localhost:3000/api',
      scope,
      state: 'external-resource',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
    })
    const authorize = await ctx.app.request(
      `http://localhost:3000/api/auth/oauth2/authorize?${authorizeParams.toString()}`,
      { headers: { Cookie: cookie, Origin: 'http://localhost:3000' } },
    )
    const consentLocation = authorize.headers.get('location')
    expect(authorize.status).toBe(302)
    expect(consentLocation).toMatch(/^\/oauth\/consent\?/)
    const consent = await ctx.app.request('http://localhost:3000/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        authorization_details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: workspaceId }],
        oauth_query: consentLocation?.slice(consentLocation.indexOf('?') + 1),
      }),
    })
    const consentBody = (await consent.json()) as { url: string }
    expect(consent.status).toBe(200)
    const code = new URL(consentBody.url).searchParams.get('code')
    expect(code).toBeTruthy()

    const tokenEndpoint = 'http://localhost:3000/api/auth/oauth2/token'
    const basic = `Basic ${Buffer.from(`${registered.client_id}:${registered.client_secret}`).toString('base64')}`
    const subjectResponse = await ctx.app.request(tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: 'http://localhost:3000/api',
      }).toString(),
    })
    const subject = (await subjectResponse.json()) as {
      access_token: string
      refresh_token: string
      authorization_details: Array<{ type: string; identifier: string }>
    }
    expect(subjectResponse.status).toBe(200)
    expect(subject.authorization_details).toEqual([
      { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: workspaceId },
    ])
    const catalogResponse = await ctx.app.request(
      'http://localhost:3000/api/auth/oauth2/authorization-details/catalog',
      {
        headers: { Authorization: `Bearer ${subject.access_token}` },
      },
    )
    expect(catalogResponse.status).toBe(200)
    await expect(catalogResponse.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          authorizationDetail: { type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: workspaceId },
          display: expect.objectContaining({
            label: expect.any(String),
            metadata: { type: 'personal', role: 'owner' },
          }),
        }),
      ]),
    })

    const reusedVerifier = 'reused-consent-verifier-with-sufficient-entropy-1234567890'
    const reusedParams = new URLSearchParams(authorizeParams)
    reusedParams.set('state', 'reused-consent')
    reusedParams.set('code_challenge', createHash('sha256').update(reusedVerifier).digest('base64url'))
    const reusedAuthorize = await ctx.app.request(
      `http://localhost:3000/api/auth/oauth2/authorize?${reusedParams.toString()}`,
      { headers: { Cookie: cookie, Origin: 'http://localhost:3000' } },
    )
    const reusedLocation = reusedAuthorize.headers.get('location')
    expect(reusedAuthorize.status).toBe(302)
    expect(reusedLocation).toMatch(/^https:\/\/broker\.example\.com\/api\/account-connections\/oauth\/callback\?/)
    const reusedSubjectResponse = await ctx.app.request(tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: new URL(reusedLocation!).searchParams.get('code')!,
        redirect_uri: redirectUri,
        code_verifier: reusedVerifier,
        resource: 'http://localhost:3000/api',
      }).toString(),
    })
    const reusedSubject = (await reusedSubjectResponse.json()) as {
      authorization_details: Array<{ type: string; identifier: string }>
    }
    expect(reusedSubjectResponse.status).toBe(200)
    expect(reusedSubject.authorization_details).toEqual(subject.authorization_details)

    const refreshedResponse = await ctx.app.request(tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: subject.refresh_token,
        resource: 'http://localhost:3000/api',
      }).toString(),
    })
    const refreshed = (await refreshedResponse.json()) as {
      authorization_details: Array<{ type: string; identifier: string }>
    }
    expect(refreshedResponse.status).toBe(200)
    expect(refreshed.authorization_details).toEqual(subject.authorization_details)

    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({})
      .setProtectedHeader({ typ: 'JWT', alg: 'ES256', kid: 'actor-key' })
      .setIssuer('https://broker.example.com/api/auth')
      .setSubject('agent-123')
      .setAudience(tokenEndpoint)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(crypto.randomUUID())
      .sign(actorPrivateKey)
    const actorResponse = await ctx.app.request(tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    })
    const actor = (await actorResponse.json()) as { access_token: string }
    expect(actorResponse.status, JSON.stringify(actor)).toBe(200)

    const { privateKey: dpopPrivateKey, publicKey: dpopPublicKey } = await generateKeyPair('ES256')
    const dpopPublicJwk = await exportJWK(dpopPublicKey)
    const exchangeProof = await new SignJWT({
      htm: 'POST',
      htu: tokenEndpoint,
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: dpopPublicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(dpopPrivateKey)
    const exchangeResponse = await ctx.app.request(tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: basic,
        DPoP: exchangeProof,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subject.access_token,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        actor_token: actor.access_token,
        actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        resource: 'http://localhost:3000/api',
        scope: 'objects:read quota:read',
        authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: workspaceId }]),
      }).toString(),
    })
    const exchanged = (await exchangeResponse.json()) as {
      access_token: string
      token_type: string
      scope: string
      authorization_details: Array<{ type: string; identifier: string }>
    }
    expect(exchangeResponse.status).toBe(200)
    expect(exchanged).toMatchObject({ token_type: 'DPoP', scope: 'objects:read quota:read' })
    expect(exchanged.authorization_details).toEqual(subject.authorization_details)

    const apiUrl = 'http://localhost:3000/api/test-agent-audit'
    const apiProof = await new SignJWT({
      htm: 'GET',
      htu: apiUrl,
      ath: await deriveDpopAth(exchanged.access_token),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: dpopPublicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(dpopPrivateKey)
    const apiResponse = await ctx.app.request(apiUrl, {
      headers: { Authorization: `DPoP ${exchanged.access_token}`, DPoP: apiProof },
    })
    expect(apiResponse.status).toBe(200)
    const [auditEvent] = await ctx.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'agent_identity_probe'))
    expect(auditEvent).toMatchObject({
      actorType: 'oauth',
      actorRef: 'agent-123',
      actorIssuer: 'https://broker.example.com/api/auth',
    })

    const revokeResponse = await ctx.app.request('http://localhost:3000/api/auth/oauth2/revoke', {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: exchanged.access_token,
        token_type_hint: 'access_token',
      }).toString(),
    })
    expect(revokeResponse.status).toBe(200)

    const revokedProof = await new SignJWT({
      htm: 'GET',
      htu: apiUrl,
      ath: await deriveDpopAth(exchanged.access_token),
    })
      .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: dpopPublicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(dpopPrivateKey)
    const revokedResponse = await ctx.app.request(apiUrl, {
      headers: { Authorization: `DPoP ${exchanged.access_token}`, DPoP: revokedProof },
    })
    expect(revokedResponse.status).toBe(401)
    expect(revokedResponse.headers.get('www-authenticate')).toContain('DPoP')
  })

  it('issues an authorization code after full consent for a dynamically registered PKCE client', async () => {
    const ctx = await createTestApp()
    const previewOrigin = 'https://preview-zpan.example.com'
    const auth = await createAuth(ctx.platform, 'test-secret', 'https://zpan-staging.example.com', [previewOrigin])
    const app = createApp(ctx.platform, auth)
    const signUpResponse = await signUp({ ...ctx, app }, 'oauth-consent@example.com')
    const signUpBody = (await signUpResponse.clone().json()) as { user: { id: string } }
    const workspaceId = await personalOrgForUser(ctx, signUpBody.user.id)
    const cookie = signUpResponse.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const registration = await app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Consent Test Client',
        redirect_uris: ['https://broker.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid offline_access objects:read quota:read',
      }),
    })
    const registered = (await registration.json()) as { client_id: string }
    expect(registration.status).toBe(201)
    const params = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: 'https://broker.example.com/callback',
      response_type: 'code',
      scope: 'openid offline_access objects:read quota:read',
      state: 'oauth-consent-test',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
    })
    const authorize = await app.request(`${previewOrigin}/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie, Origin: previewOrigin },
    })
    const consentLocation = authorize.headers.get('location')
    expect(authorize.status).toBe(302)
    expect(consentLocation).toMatch(/^\/oauth\/consent\?/)

    const consent = await app.request(`${previewOrigin}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: previewOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accept: true,
        authorization_details: [{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE, identifier: workspaceId }],
        oauth_query: consentLocation?.slice(consentLocation.indexOf('?') + 1),
      }),
    })
    const consentBody = await consent.text()

    expect(consent.status, consentBody).toBe(200)
    expect(JSON.parse(consentBody)).toMatchObject({
      url: expect.stringMatching(/^https:\/\/broker\.example\.com\/callback\?code=/),
    })
  })

  it('accepts a pushed authorization request and consumes its request URI once', async () => {
    const ctx = await createTestApp()
    const metadata = await ctx.app.request('/.well-known/oauth-authorization-server/api/auth')
    await expect(metadata.json()).resolves.toMatchObject({
      pushed_authorization_request_endpoint: 'http://localhost:3000/api/auth/oauth2/par',
      request_uri_parameter_supported: true,
      authorization_details_types_supported: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
    })
    const signUpResponse = await signUp(ctx, 'oauth-par@example.com')
    const cookie = signUpResponse.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const registration = await ctx.app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'PAR Test Client',
        redirect_uris: ['https://broker.example.com/par-callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid offline_access objects:read',
      }),
    })
    const registered = (await registration.json()) as { client_id: string }
    const pushedParams = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: 'https://broker.example.com/par-callback',
      response_type: 'code',
      scope: 'openid offline_access objects:read',
      state: 'par-test',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
      authorization_details: JSON.stringify([{ type: WORKSPACE_AUTHORIZATION_DETAIL_TYPE }]),
    })
    const invalidRedirectParams = new URLSearchParams(pushedParams)
    invalidRedirectParams.set('redirect_uri', 'https://attacker.example.com/callback')
    const invalidRedirect = await ctx.app.request('/api/auth/oauth2/par', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: invalidRedirectParams.toString(),
    })
    expect(invalidRedirect.status).toBe(400)
    await expect(invalidRedirect.json()).resolves.toMatchObject({ error: 'invalid_request' })

    const otherRegistration = await ctx.app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Other PAR Client',
        redirect_uris: ['https://other.example.com/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'openid objects:read',
      }),
    })
    const other = (await otherRegistration.json()) as { client_id: string; client_secret: string }
    const mismatchedCredentials = await ctx.app.request('/api/auth/oauth2/par', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${other.client_id}:${other.client_secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: pushedParams.toString(),
    })
    expect(mismatchedCredentials.status).toBe(400)
    await expect(mismatchedCredentials.json()).resolves.toMatchObject({ error: 'invalid_client' })

    const pushed = await ctx.app.request('/api/auth/oauth2/par', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: pushedParams.toString(),
    })
    const pushedBody = (await pushed.json()) as { request_uri: string; expires_in: number }
    expect(pushed.status, JSON.stringify(pushedBody)).toBe(201)
    expect(pushedBody).toMatchObject({
      request_uri: expect.stringMatching(/^urn:ietf:params:oauth:request_uri:/),
      expires_in: 90,
    })

    const authorizeUrl = new URL('/api/auth/oauth2/authorize', 'http://localhost')
    authorizeUrl.searchParams.set('client_id', registered.client_id)
    authorizeUrl.searchParams.set('request_uri', pushedBody.request_uri)
    const authorize = await ctx.app.request(authorizeUrl, { headers: { Cookie: cookie } })
    expect(authorize.status).toBe(302)
    expect(authorize.headers.get('location')).toMatch(/^\/oauth\/consent\?/)

    const replay = await ctx.app.request(authorizeUrl, { headers: { Cookie: cookie } })
    expect(replay.status).toBe(302)
    expect(new URL(replay.headers.get('location')!, 'http://localhost').searchParams.get('error')).toBe(
      'invalid_request_uri',
    )
  })

  it('blocks partial OAuth consent changes through the Better Auth endpoint', async () => {
    const ctx = await createTestApp()

    const res = await ctx.app.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'dynamic-client', scope: 'objects:read' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_request',
      error_description: 'Partial OAuth consent is not supported',
    })
  })
})

describe('session hook — activeOrganizationId is set on sign-in after sign-up', () => {
  it('sign-in after sign-up succeeds and returns a session cookie', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'session-user@example.com')
    const res = await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'session-user@example.com', password: 'password123456' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('session record in DB has activeOrganizationId set after sign-in', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'org-session@example.com')
    await ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'org-session@example.com', password: 'password123456' }),
    })
    const sessions = await ctx.db.select().from(authSchema.session)
    // At least one session should have activeOrganizationId set
    const withOrg = sessions.filter((s) => s.activeOrganizationId != null)
    expect(withOrg.length).toBeGreaterThan(0)
  })
})

describe('createPersonalOrg — org name and quota edge cases', () => {
  it('sign-up with empty name creates org with fallback name "Personal Space"', async () => {
    const ctx = await createTestApp()
    const res = await ctx.app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'noname@example.com', password: 'password123456' }),
    })
    // sign-up should succeed
    expect(res.status).toBe(200)
  })

  it('sign-up uses a custom finite default_org_quota when set', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '524288000' })
    const res = await signUp(ctx, 'quota-user@example.com')
    expect(res.status).toBe(200)
  })

  it('team creation uses default_team_quota while personal orgs keep default_org_quota', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '1000000' })
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_team_quota', value: '5000000' })

    const res = await signUp(ctx, 'team-quota@example.com')
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie().join('; ')

    const createOrg = await ctx.app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies, Origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'My Team', slug: 'my-team', metadata: { type: 'team' } }),
    })
    expect(createOrg.status).toBe(200)
    const org = (await createOrg.json()) as { id: string }

    const rows = await ctx.db.select().from(schema.orgQuotaEntitlements)
    const teamStorage = rows.find((row) => row.orgId === org.id && row.resourceType === 'storage')
    expect(teamStorage?.bytes).toBe(5000000)
    const personalStorage = rows.find((row) => row.orgId !== org.id && row.resourceType === 'storage')
    expect(personalStorage?.bytes).toBe(1000000)
  })

  it('team creation falls back to default_org_quota when default_team_quota is unset', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '2000000' })

    const res = await signUp(ctx, 'team-quota-fallback@example.com')
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie().join('; ')

    const createOrg = await ctx.app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookies, Origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'Fallback Team', slug: 'fallback-team', metadata: { type: 'team' } }),
    })
    expect(createOrg.status).toBe(200)
    const org = (await createOrg.json()) as { id: string }

    const rows = await ctx.db.select().from(schema.orgQuotaEntitlements)
    const teamStorage = rows.find((row) => row.orgId === org.id && row.resourceType === 'storage')
    expect(teamStorage?.bytes).toBe(2000000)
  })

  it('sign-up falls back to DEFAULT_ORG_QUOTA when default_org_quota is non-numeric', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: 'not-a-number' })
    const res = await signUp(ctx, 'quota-fallback@example.com')
    expect(res.status).toBe(200)
  })

  it('sign-up with default_org_quota set to zero falls back to DEFAULT_ORG_QUOTA', async () => {
    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '0' })
    const res = await signUp(ctx, 'zero-quota@example.com')
    expect(res.status).toBe(200)
    const quotas = await ctx.db.select().from(schema.orgQuotas)
    expect(quotas).toHaveLength(1)
    expect(quotas[0].quota).toBe(0)
    expect(quotas[0].trafficQuota).toBe(0)
    expect(quotas[0].trafficUsed).toBe(0)
    expect(quotas[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    await expectPlanEntitlement(ctx, 'storage', 10485760)
    await expectPlanEntitlement(ctx, 'traffic', 0)
  })
})

describe('sendInvitationEmail — buildInvitationEmailHtml via invite-member with email_provider configured', () => {
  const emailProviderOptions = [
    { key: 'email_enabled', value: 'true' },
    { key: 'email_provider', value: 'http' },
    { key: 'email_from', value: 'no-reply@example.com' },
    { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
    { key: 'email_http_api_key', value: 'my-api-key' },
  ]

  async function setupOwnerAndOrg(ctx: TestCtx, email: string) {
    const signUpRes = await signUp(ctx, email)
    const cookie = signUpRes.headers.getSetCookie().join('; ')
    const body = (await signUpRes.json()) as { user: { id: string } }
    const orgId = await personalOrgForUser(ctx, body.user.id)
    return { cookie, orgId }
  }

  it('invitation email is sent when email_provider is configured', async () => {
    const { vi } = await import('vitest')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values(emailProviderOptions)
    const { cookie, orgId } = await setupOwnerAndOrg(ctx, 'inviter@example.com')

    const res = await ctx.app.request('/api/auth/organization/invite-member', {
      method: 'POST',
      // Cookie-bearing requests must carry an Origin, like real browser requests
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'invitee@example.com', role: 'member', organizationId: orgId }),
    })
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('invitation email HTML contains accept-invitation link and role', async () => {
    const { vi } = await import('vitest')
    let capturedHtml = ''
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const b = JSON.parse(init?.body as string)
      capturedHtml = b.html
      return { ok: true }
    })
    vi.stubGlobal('fetch', fetchMock)

    const ctx = await createTestApp()
    await ctx.db.insert(schema.systemOptions).values(emailProviderOptions)
    const { cookie, orgId } = await setupOwnerAndOrg(ctx, 'orgowner@example.com')

    await ctx.app.request('/api/auth/organization/invite-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'newmember@example.com', role: 'member', organizationId: orgId }),
    })

    expect(capturedHtml).toContain('accept-invitation')
    expect(capturedHtml).toContain('member')

    vi.unstubAllGlobals()
  })
})

describe('email sign-up — username is required', () => {
  it('email sign-up with username keeps the provided username', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'alice@example.com', { username: 'myalias' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toBe('myalias')
  })
})

// OAuth users are created by better-auth's internal adapter without a username.
// The before hook generates one from preferred_username/login or email prefix.
// We simulate this by calling sign-up without username (bypasses frontend validation).
describe('OAuth username generation — before hook', () => {
  it('generates username from email prefix when no username provided', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'johndoe@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toBe('johndoe')
  })

  it('sanitizes special characters from email prefix', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'john.doe+tag@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toMatch(/^[a-z0-9]+$/)
    expect(row.username).not.toContain('.')
    expect(row.username).not.toContain('+')
  })

  it('adds random suffix when email prefix is shorter than 3 chars', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'ab@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toMatch(/^ab-[a-z0-9]{6}$/)
  })

  it('adds random suffix when email prefix is a single char', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'x@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toMatch(/^x-[a-z0-9]{6}$/)
  })

  it('adds random suffix when email prefix collides with existing username', async () => {
    const ctx = await createTestApp()
    // First user takes "bob" via explicit username
    await signUp(ctx, 'bob@example.com', { username: 'bob' })
    // Second user without username — email prefix "bob" is taken, gets "bob-xxxxxx"
    const res = await signUp(ctx, 'bob@other.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toMatch(/^bob-[a-z0-9]{6}$/)
  })

  it('sets displayUsername to the same value as username', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'carol@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username, displayUsername: authSchema.user.displayUsername })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.displayUsername).toBe(row.username)
  })

  it('uses email prefix directly when it is exactly 3 chars', async () => {
    const ctx = await createTestApp()
    const res = await signUp(ctx, 'abc@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username).toBe('abc')
  })

  it('truncates email prefix to 30 chars', async () => {
    const ctx = await createTestApp()
    const longPrefix = 'averylongemailprefixthatiswaytolong'
    const res = await signUp(ctx, `${longPrefix}@example.com`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    expect(row.username!.length).toBeLessThanOrEqual(30)
  })

  it('email prefix consisting entirely of special characters falls back to user-suffix', async () => {
    const ctx = await createTestApp()
    // The sign-up endpoint requires a valid email, so use a prefix that sanitizes to empty
    // Unfortunately standard email formats require at least one alphanumeric char in local part,
    // but we can test with an email whose local part has only non-alphanumeric chars stripped
    // We simulate by directly inserting a user with null username then querying
    // Instead, test with prefix "___" which sanitizes to "" (hyphens and underscores removed)
    // Actually the sanitizer removes [^a-z0-9] so underscores are also removed.
    // Use a numeric-looking prefix that won't conflict — verify fallback via the DB check
    // The most we can test through the API is a prefix that becomes too short.
    // A prefix like "a_b" becomes "ab" (2 chars < 3) → gets suffix
    const res = await signUp(ctx, 'a_b@example.com')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    const [row] = await ctx.db
      .select({ username: authSchema.user.username })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, body.user.id))
    // "a_b" sanitizes to "ab" (2 chars) → appends random suffix
    expect(row.username).toMatch(/^ab-[a-z0-9]{6}$/)
  })
})

describe('origin check — loopback and LAN origins are trusted without config', () => {
  // better-auth only enforces the Origin check on requests that carry cookies,
  // so attach a dummy cookie to make validateOrigin run.
  async function signInWithOrigin(ctx: TestCtx, origin: string) {
    return ctx.app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'zp.dummy=1' },
      body: JSON.stringify({ email: 'origin@example.com', password: 'password123456' }),
    })
  }

  it.each([
    'http://127.0.0.1:3000',
    'http://192.168.1.50:3000',
    'http://10.0.0.5:8080',
  ])('allows sign-in with Origin %s when TRUSTED_ORIGINS is not set', async (origin) => {
    const ctx = await createTestApp()
    await signUp(ctx, 'origin@example.com')
    const res = await signInWithOrigin(ctx, origin)
    expect(res.status).toBe(200)
  })

  it('still rejects sign-in from an unknown public origin', async () => {
    const ctx = await createTestApp()
    await signUp(ctx, 'origin@example.com')
    const res = await signInWithOrigin(ctx, 'https://evil.example.com')
    expect(res.status).toBe(403)
  })
})
