import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus } from '../../shared/constants'
import { createMatterRepo } from '../adapters/repos/matter'
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

  describe('GET /api/storage/items', () => {
    async function seedDocuments(count: number) {
      const ctx = await createTestApp()
      const headers = await authedHeaders(ctx.app, 'storage-items@example.com')
      const [org] = await ctx.db.all<{ id: string }>(
        sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
      )
      const now = Date.now()
      await ctx.db.run(sql`
        INSERT INTO storages (
          id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
          capacity, used, status, created_at, updated_at
        ) VALUES ('storage-1', 'bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
      `)
      const matter = createMatterRepo(ctx.db)
      for (let i = 0; i < count; i++) {
        await matter.create({
          orgId: org.id,
          name: `doc-${i}.pdf`,
          type: 'application/pdf',
          size: (i % 2) * 10,
          dirtype: DirType.FILE,
          parent: '',
          object: `doc-${i}.pdf`,
          storageId: 'storage-1',
          status: ObjectStatus.ACTIVE,
        })
      }
      return { ...ctx, headers }
    }

    type ItemPage = { items: Array<{ id: string; name: string }>; nextPageToken: string | null }

    it('requires authentication', async () => {
      const { app } = await createTestApp()
      expect((await app.request('/api/storage/items?category=documents')).status).toBe(401)
    })

    it.each(['asc', 'desc'])('pages every item once with ties broken by id (size %s)', async (sortDir) => {
      const { app, headers } = await seedDocuments(5)
      const ids: string[] = []
      const sizes: number[] = []
      let token: string | null = null
      for (let i = 0; i < 6; i++) {
        const query = new URLSearchParams({ category: 'documents', sortBy: 'size', sortDir, pageSize: '2' })
        if (token) query.set('pageToken', token)
        const res = await app.request(`/api/storage/items?${query}`, { headers })
        expect(res.status).toBe(200)
        const body = (await res.json()) as ItemPage
        sizes.push(body.items.length)
        ids.push(...body.items.map((item) => item.id))
        token = body.nextPageToken
        if (!token) break
      }
      expect(sizes).toEqual([2, 2, 1])
      expect(new Set(ids).size).toBe(5)
    })

    it('rejects a tampered token and a token reused with another sort', async () => {
      const { app, headers } = await seedDocuments(3)
      const base = { category: 'documents', sortBy: 'size', sortDir: 'desc', pageSize: '2' }
      const first = await app.request(`/api/storage/items?${new URLSearchParams(base)}`, { headers })
      const { nextPageToken } = (await first.json()) as ItemPage
      expect(nextPageToken).toBeTruthy()

      const tampered = await app.request(
        `/api/storage/items?${new URLSearchParams({ ...base, pageToken: `${nextPageToken}x` })}`,
        { headers },
      )
      expect(tampered.status).toBe(400)
      const reused = await app.request(
        `/api/storage/items?${new URLSearchParams({ ...base, sortDir: 'asc', pageToken: nextPageToken as string })}`,
        { headers },
      )
      expect(reused.status).toBe(400)
      expect(await reused.json()).toMatchObject({ error: { details: [{ reason: 'INVALID_PAGE_TOKEN' }] } })
    })
  })
})
