import { isPersonalOrgLike } from '@shared/org-slugs'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_SITE_KEY_KEY } from '../../../shared/captcha.js'
import * as authSchema from '../../db/auth-schema.js'
import * as schema from '../../db/schema.js'
import { createTestApp } from '../../test/setup.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectPlanEntitlement(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  resourceType: 'storage' | 'traffic',
  bytes: number,
) {
  const rows = await db.select().from(schema.orgQuotaEntitlements).where(eq(schema.orgQuotaEntitlements.orgId, orgId))
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

async function personalOrgForUser(db: Awaited<ReturnType<typeof createTestApp>>['db'], userId: string) {
  const rows = await db
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
  return org
}

describe('Auth API', () => {
  it('POST /api/auth/sign-up/email creates user', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password123456' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { email: string } }
    expect(body.user.email).toBe('test@example.com')
  })

  it('POST /api/auth/sign-in/email signs in', async () => {
    const { app } = await createTestApp()
    // First sign up
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'login@example.com', password: 'password123456' }),
    })
    // Then sign in
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login@example.com', password: 'password123456' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('POST /api/auth/request-password-reset is accepted (password reset is wired)', async () => {
    const { app } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reset', email: 'reset@example.com', password: 'password123456' }),
    })
    const res = await app.request('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'reset@example.com', redirectTo: '/reset-password' }),
    })
    // Endpoint exists and the sendResetPassword hook runs without error (email
    // is unconfigured in tests, so it no-ops). Not a 404 = the flow is mounted.
    expect(res.status).toBe(200)
  })

  it('POST /api/auth/sign-in/email rejects missing captcha token when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'captcha-login@example.com', password: 'password123456' }),
    })
    await db.insert(schema.systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true' },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key' },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key' },
    ])

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'captcha-login@example.com', password: 'password123456' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'Missing CAPTCHA response' })
  })

  it('POST /api/auth/sign-up/email rejects missing captcha token when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true' },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key' },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key' },
    ])

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'captcha-signup@example.com', password: 'password123456' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ message: 'Missing CAPTCHA response' })
  })

  it('POST /api/auth/sign-in/email accepts valid captcha token when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'captcha-valid@example.com', password: 'password123456' }),
    })
    await db.insert(schema.systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true' },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key' },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key' },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))))

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-captcha-response': 'valid-token' },
      body: JSON.stringify({
        email: 'captcha-valid@example.com',
        password: 'password123456',
      }),
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('POST /api/auth/sign-up/email accepts valid captcha token when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true' },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key' },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key' },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))))

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-captcha-response': 'valid-token' },
      body: JSON.stringify({
        name: 'Test',
        email: 'captcha-signup-valid@example.com',
        password: 'password123456',
      }),
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('POST /api/auth/sign-in/email rejects wrong password', async () => {
    const { app } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'wrong@example.com', password: 'password123456' }),
    })
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wrong@example.com', password: 'wrongpassword' }),
    })
    expect(res.status).not.toBe(200)
  })

  it('first user gets admin role after signup', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin User', email: 'admin@example.com', password: 'password123456' }),
    })
    const users = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'admin@example.com'))
    expect(users[0].role).toBe('admin')
  })

  it('first user gets a personal organization created after signup', async () => {
    const { app, db } = await createTestApp()
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin User', email: 'admin@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const org = await personalOrgForUser(db, userId)
    expect(org.slug).toMatch(/^u[a-z0-9]{16}$/)
    expect(JSON.parse(org.metadata!)).toEqual({ type: 'personal' })
  })

  it('second user does NOT get admin role', async () => {
    const { app, db } = await createTestApp()
    // First user
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First', email: 'first@example.com', password: 'password123456' }),
    })
    // Second user
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second', email: 'second@example.com', password: 'password123456' }),
    })
    const users = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'second@example.com'))
    expect(users[0].role).not.toBe('admin')
  })

  it('second user also gets a personal organization created', async () => {
    const { app, db } = await createTestApp()
    // First user
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First', email: 'first@example.com', password: 'password123456' }),
    })
    // Second user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second', email: 'second@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const org = await personalOrgForUser(db, userId)
    expect(org.slug).toMatch(/^u[a-z0-9]{16}$/)
    expect(JSON.parse(org.metadata!)).toEqual({ type: 'personal' })
  })

  it('second user gets a member record with owner role in their personal org', async () => {
    const { app, db } = await createTestApp()
    // First user
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'First', email: 'first@example.com', password: 'password123456' }),
    })
    // Second user
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Second', email: 'second@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const orgId = (await personalOrgForUser(db, userId)).id

    const members = await db.select().from(authSchema.member).where(eq(authSchema.member.organizationId, orgId))
    expect(members).toHaveLength(1)
    expect(members[0].userId).toBe(userId)
    expect(members[0].role).toBe('owner')
  })

  it('signup without default_org_quota set creates an org_quotas row with quota=10485760 (built-in default)', async () => {
    const { app, db } = await createTestApp()
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'quota-none@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const orgId = (await personalOrgForUser(db, userId)).id

    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(0)
    expect(rows[0].used).toBe(0)
    expect(rows[0].trafficQuota).toBe(0)
    expect(rows[0].trafficUsed).toBe(0)
    expect(rows[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    await expectPlanEntitlement(db, orgId, 'storage', 10485760)
    await expectPlanEntitlement(db, orgId, 'traffic', 0)
  })

  it('signup with default quotas set creates an org_quotas row with storage and monthly traffic quotas', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '1073741824' })
    await db.insert(schema.systemOptions).values({ key: 'default_org_monthly_traffic_quota', value: '2147483648' })
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'quota-set@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const orgId = (await personalOrgForUser(db, userId)).id

    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(0)
    expect(rows[0].used).toBe(0)
    expect(rows[0].trafficQuota).toBe(0)
    expect(rows[0].trafficUsed).toBe(0)
    expect(rows[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    await expectPlanEntitlement(db, orgId, 'storage', 1073741824)
    await expectPlanEntitlement(db, orgId, 'traffic', 2147483648)
  })

  it('team org creation initializes storage and monthly traffic quotas from defaults', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '1073741824' })
    await db.insert(schema.systemOptions).values({ key: 'default_org_monthly_traffic_quota', value: '2147483648' })
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'team-quota@example.com', password: 'password123456' }),
    })
    const cookie = signUpRes.headers.getSetCookie().join('; ')

    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:3000' },
      body: JSON.stringify({ name: 'Team Quota', slug: 'team-quota' }),
    })
    expect(createRes.status).toBe(200)
    const org = (await createRes.json()) as { id: string }

    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, org.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(0)
    expect(rows[0].used).toBe(0)
    expect(rows[0].trafficQuota).toBe(0)
    expect(rows[0].trafficUsed).toBe(0)
    expect(rows[0].trafficPeriod).toMatch(/^\d{4}-\d{2}$/)
    await expectPlanEntitlement(db, org.id, 'storage', 1073741824)
    await expectPlanEntitlement(db, org.id, 'traffic', 2147483648)
  })

  it('signup fails when stored default monthly traffic quota is invalid', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_monthly_traffic_quota', value: '-1' })

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'bad-traffic-default@example.com', password: 'password123456' }),
    })

    expect(res.status).not.toBe(200)
  })

  it('signup with default_org_quota set to 0 creates a built-in default org_quotas row', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '0' })
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'quota-zero@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const org = await personalOrgForUser(db, body.user.id)
    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, org.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(0)
    await expectPlanEntitlement(db, org.id, 'storage', 10485760)
  })

  it('sign-in with a malformed stored password hash returns a non-200 error response', async () => {
    const { app, db } = await createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'malformed@example.com', password: 'password123456' }),
    })
    // Corrupt the stored password so verifyPassword receives a hash with no colon separator
    await db
      .update(authSchema.account)
      .set({ password: 'nocolonhashvalue' })
      .where(eq(authSchema.account.providerId, 'credential'))
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'malformed@example.com', password: 'password123456' }),
    })
    expect(res.status).not.toBe(200)
  })
})
