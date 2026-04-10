import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'

describe('Auth API', () => {
  it('POST /api/auth/sign-up/email creates user', async () => {
    const { app } = createTestApp()
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
    const { app } = createTestApp()
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
    const { app } = createTestApp()
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
    const { app, db } = createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin User', email: 'admin@example.com', password: 'password123456' }),
    })
    const users = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'admin@example.com'))
    expect(users[0].role).toBe('admin')
  })

  it('first user gets a personal organization created after signup', async () => {
    const { app, db } = createTestApp()
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
    const { app, db } = createTestApp()
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
    const { app, db } = createTestApp()
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
    const { app, db } = createTestApp()
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
})
