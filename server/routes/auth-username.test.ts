import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import { createTestApp } from '../test/setup.js'

describe('migration 0004_username_plugin.sql', () => {
  const migrationPath = join(process.cwd(), 'migrations/0004_username_plugin.sql')
  const sql = readFileSync(migrationPath, 'utf-8')

  it('adds the username column to the user table', () => {
    expect(sql).toMatch(/ALTER TABLE.*`user`.*ADD.*`username`.*text/i)
  })

  it('adds the display_username column to the user table', () => {
    expect(sql).toMatch(/ALTER TABLE.*`user`.*ADD.*`display_username`.*text/i)
  })

  it('creates a unique index on the username column', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX.*`user_username_unique`.*ON.*`user`.*\(`username`\)/i)
  })
})

describe('username plugin — sign-up with username', () => {
  it('sign-up with username stores the username on the user record', async () => {
    const { app, db } = createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123456',
        username: 'alice42',
      }),
    })
    const users = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'alice@example.com'))
    expect(users[0].username).toBe('alice42')
  })

  it('sign-up without username leaves the username column null', async () => {
    const { app, db } = createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com', password: 'password123456' }),
    })
    const users = await db.select().from(authSchema.user).where(eq(authSchema.user.email, 'bob@example.com'))
    expect(users[0].username).toBeNull()
  })

  it('sign-up with duplicate username returns a non-200 response', async () => {
    const { app } = createTestApp()
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'First',
        email: 'first@example.com',
        password: 'password123456',
        username: 'shared_handle',
      }),
    })
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Second',
        email: 'second@example.com',
        password: 'password123456',
        username: 'shared_handle',
      }),
    })
    expect(res.status).not.toBe(200)
  })

  it('two users with different usernames both register successfully', async () => {
    const { app, db } = createTestApp()
    const res1 = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User1', email: 'u1@example.com', password: 'password123456', username: 'user1' }),
    })
    const res2 = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User2', email: 'u2@example.com', password: 'password123456', username: 'user2' }),
    })
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const allUsers = await db.select().from(authSchema.user)
    const usernames = allUsers.map((u) => u.username)
    expect(usernames).toContain('user1')
    expect(usernames).toContain('user2')
  })
})
