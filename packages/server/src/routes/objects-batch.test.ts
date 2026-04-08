import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

function seedStorage(db: ReturnType<typeof createTestApp>['db']) {
  const now = Date.now()
  return db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, capacity, used, status, created_at, updated_at)
    VALUES ('s1', 'Test', 'private', 'bucket', 'http://localhost:9000', 'auto', 'key', 'secret', '$UID/$RAW_NAME', 0, 0, 'active', ${now}, ${now})
  `)
}

async function seedMatterForUser(
  db: ReturnType<typeof createTestApp>['db'],
  orgId: string,
  id: string,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now()
  const defaults = {
    alias: `alias-${id}`,
    name: 'test.txt',
    type: 'text/plain',
    size: 100,
    dirtype: 0,
    parent: '',
    object: `${orgId}/${id}.txt`,
    storageId: 's1',
    status: 'active',
  }
  const m = { ...defaults, ...overrides }
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${m.alias as string}, ${m.name as string}, ${m.type as string}, ${m.size as number}, ${m.dirtype as number}, ${m.parent as string}, ${m.object as string}, ${m.storageId as string}, ${m.status as string}, ${now}, ${now})
  `)
}

async function getOrgId(db: ReturnType<typeof createTestApp>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
  return rows[0].id
}

describe('Batch API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/batch/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'], parent: 'folder1' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /api/batch/move returns 400 for invalid body', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/batch/move moves items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    await seedStorage(db)
    await seedMatterForUser(db, orgId, 'f1')
    await seedMatterForUser(db, orgId, 'f2')

    const res = await app.request('/api/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1', 'f2'], parent: 'new-parent' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })

    const rows = await db.all<{ parent: string }>(sql`SELECT parent FROM matters WHERE id IN ('f1', 'f2')`)
    expect(rows.every((r) => r.parent === 'new-parent')).toBe(true)
  })

  it('POST /api/batch/trash trashes items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    await seedStorage(db)
    await seedMatterForUser(db, orgId, 'f1')
    await seedMatterForUser(db, orgId, 'f2')

    const res = await app.request('/api/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1', 'f2'] }),
    })
    expect(res.status).toBe(200)

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id IN ('f1', 'f2')`)
    expect(rows.every((r) => r.status === 'trashed')).toBe(true)
  })

  it('POST /api/batch/delete deletes trashed items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    await seedStorage(db)
    await seedMatterForUser(db, orgId, 'f1', { status: 'trashed', object: '' })

    const res = await app.request('/api/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'] }),
    })
    expect(res.status).toBe(200)

    const rows = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM matters WHERE id = 'f1'`)
    expect(rows[0].count).toBe(0)
  })

  it('POST /api/batch/delete rejects non-trashed items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)

    await seedStorage(db)
    await seedMatterForUser(db, orgId, 'f1', { status: 'active' })

    const res = await app.request('/api/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/batch/trash returns 400 for invalid body', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/batch/trash rejects if ID belongs to different org', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)

    await seedStorage(db)
    await seedMatterForUser(db, 'other-org', 'f1')

    const res = await app.request('/api/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'] }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/batch/delete returns 400 for invalid body', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/batch/delete rejects if ID belongs to different org', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)

    await seedStorage(db)
    await seedMatterForUser(db, 'other-org', 'f1', { status: 'trashed' })

    const res = await app.request('/api/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'] }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/batch/move rejects if ID belongs to different org', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)

    await seedStorage(db)
    await seedMatterForUser(db, 'other-org', 'f1')

    const res = await app.request('/api/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'], parent: 'new-parent' }),
    })
    expect(res.status).toBe(404)
  })
})
