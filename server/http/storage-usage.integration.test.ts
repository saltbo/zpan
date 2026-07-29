import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup'

describe('storage usage API', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/storage')).status).toBe(401)
  })

  it('returns the initialized projection without exposing runtime scans', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app, 'storage-usage@example.com')

    const usageResponse = await app.request('/api/storage', { headers })
    expect(usageResponse.status).toBe(200)
    const usage = (await usageResponse.json()) as {
      breakdowns: Array<{ category: string; bytes: number }>
    }
    expect(usage.breakdowns).toHaveLength(8)
    expect(usage.breakdowns.find((row) => row.category === 'trash')?.bytes).toBe(0)

    expect((await app.request('/api/storage/scans', { method: 'POST', headers })).status).toBe(404)
  })

  it('allows a workspace API key with storage-usage:read', async () => {
    const { app, auth, db } = await createTestApp()
    await authedHeaders(app, 'storage-api-key@example.com')
    const [user] = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'storage-api-key@example.com'`)
    const [org] = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API not fully typed
    const apiKey = (await (auth.api as any).createApiKey({
      body: {
        configId: 'ihost',
        userId: user.id,
        organizationId: org.id,
        permissions: { 'storage-usage': ['read'] },
      },
    })) as { key: string }

    const res = await app.request('/api/storage', { headers: { Authorization: `Bearer ${apiKey.key}` } })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ usedBytes: 0, quotaBytes: 10485760 })
  })

  it('returns 403 for a workspace API key without storage-usage:read', async () => {
    const { app, auth, db } = await createTestApp()
    await authedHeaders(app, 'storage-api-key-denied@example.com')
    const [user] = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email = 'storage-api-key-denied@example.com'`,
    )
    const [org] = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API not fully typed
    const apiKey = (await (auth.api as any).createApiKey({
      body: { configId: 'ihost', userId: user.id, organizationId: org.id, permissions: { quota: ['read'] } },
    })) as { key: string }

    const res = await app.request('/api/storage', { headers: { Authorization: `Bearer ${apiKey.key}` } })

    expect(res.status).toBe(403)
  })
})
