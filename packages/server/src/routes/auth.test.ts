import { describe, expect, it } from 'vitest'
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
})
