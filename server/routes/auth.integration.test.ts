import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'

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

    const orgs = await db
      .select()
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, `personal-${userId}`))
    expect(orgs).toHaveLength(1)
    expect(JSON.parse(orgs[0].metadata!)).toEqual({ type: 'personal' })
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

    const orgs = await db
      .select()
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, `personal-${userId}`))
    expect(orgs).toHaveLength(1)
    expect(JSON.parse(orgs[0].metadata!)).toEqual({ type: 'personal' })
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

    const orgs = await db
      .select()
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, `personal-${userId}`))
    const orgId = orgs[0].id

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

    const orgs = await db
      .select()
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, `personal-${userId}`))
    const orgId = orgs[0].id

    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(10485760)
    expect(rows[0].used).toBe(0)
  })

  it('signup with default_org_quota set to 1073741824 creates an org_quotas row with quota=1073741824 and used=0', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '1073741824' })
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'quota-set@example.com', password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user: { id: string } }
    const userId = body.user.id

    const orgs = await db
      .select()
      .from(authSchema.organization)
      .where(eq(authSchema.organization.slug, `personal-${userId}`))
    const orgId = orgs[0].id

    const rows = await db.select().from(schema.orgQuotas).where(eq(schema.orgQuotas.orgId, orgId))
    expect(rows).toHaveLength(1)
    expect(rows[0].quota).toBe(1073741824)
    expect(rows[0].used).toBe(0)
  })

  it('signup with default_org_quota set to 0 does NOT create an org_quotas row', async () => {
    const { app, db } = await createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'default_org_quota', value: '0' })
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'quota-zero@example.com', password: 'password123456' }),
    })
    const rows = await db.select().from(schema.orgQuotas)
    expect(rows).toHaveLength(0)
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
