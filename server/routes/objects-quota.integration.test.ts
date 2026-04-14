import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { orgQuotas } from '../db/schema.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

const validStorage = {
  id: 'st-quota',
  title: 'Quota S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db'], used = 0) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${validStorage.id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket},
            ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey},
            ${validStorage.secretKey}, '', '', 0, ${used}, 'active', ${now}, ${now})
  `)
}

async function insertFile(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; size?: number; status?: string },
) {
  const now = Date.now()
  const size = opts.size ?? 100
  const status = opts.status ?? 'active'
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${size}, 0, '',
            'some/key.txt', ${validStorage.id}, ${status}, ${now}, ${now})
  `)
}

async function getOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

async function setOrgQuota(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  quota: number,
  used = 0,
) {
  const existing = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
  if (existing.length > 0) {
    await db.update(orgQuotas).set({ quota, used }).where(eq(orgQuotas.orgId, orgId))
  } else {
    await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota, used })
  }
}

// ─── POST /api/objects/:id/copy — quota enforcement ──────────────────────────

describe('POST /api/objects/:id/copy — quota enforcement', () => {
  it('returns 422 when copying a file would exceed quota', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota = 500, used = 450, file size = 100 → copy would exceed
    await setOrgQuota(db, orgId, 500, 450)
    await insertFile(db, orgId, { id: 'm-copy-over', name: 'big.txt', size: 100 })

    const res = await app.request('/api/objects/m-copy-over/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Quota exceeded')
  })

  it('returns 201 and increments orgQuotas.used when copy succeeds within quota', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota = 1000, used = 100, file size = 100 → copy is fine
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, { id: 'm-copy-ok', name: 'doc.txt', size: 100 })

    const res = await app.request('/api/objects/m-copy-ok/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(200)
  })

  it('returns 201 and increments storages.used when copy succeeds', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 50)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 50)
    await insertFile(db, orgId, { id: 'm-copy-st', name: 'img.png', size: 150 })

    await app.request('/api/objects/m-copy-st/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(storageRows[0].used).toBe(200)
  })

  it('returns 201 without incrementing usage when copying a zero-size file', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota is fully consumed, but zero-size should still pass
    await setOrgQuota(db, orgId, 500, 500)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('m-zero', ${orgId}, 'm-zero-alias', 'empty.txt', 'text/plain', 0, 0, '', '',
              ${validStorage.id}, 'active', ${now}, ${now})
    `)

    const res = await app.request('/api/objects/m-zero/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(500) // unchanged
  })

  it('returns 201 when no quota row exists (unlimited)', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // No org quota row at all — unlimited
    await insertFile(db, orgId, { id: 'm-copy-nolimit', name: 'nolimit.txt', size: 100 })

    const res = await app.request('/api/objects/m-copy-nolimit/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 201 when quota is 0 (unlimited) regardless of file size', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 0, 99999)
    await insertFile(db, orgId, { id: 'm-copy-qlimit', name: 'large.bin', size: 1000000 })

    const res = await app.request('/api/objects/m-copy-qlimit/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 404 when source file does not exist', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/objects/nonexistent/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── PATCH /api/objects/:id/done — quota enforcement via confirmUpload ─────────

describe('PATCH /api/objects/:id/done — quota enforcement via confirmUpload', () => {
  it('returns 200 and increments usage when quota allows', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 0)
    await insertFile(db, orgId, { id: 'm-done', name: 'uploading.txt', size: 350, status: 'draft' })

    const res = await app.request('/api/objects/m-done/done', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(350)
  })

  it('returns 200 and increments storages.used when quota allows', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 100)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 100)
    await insertFile(db, orgId, { id: 'm-done2', name: 'photo.jpg', size: 400, status: 'draft' })

    await app.request('/api/objects/m-done2/done', { method: 'PATCH', headers })

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(storageRows[0].used).toBe(500)
  })

  it('returns 422 when confirming upload would exceed quota', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota = 100, used = 90, file size = 50 → exceeds
    await setOrgQuota(db, orgId, 100, 90)
    await insertFile(db, orgId, { id: 'm-done-quota', name: 'toobig.txt', size: 50, status: 'draft' })

    const res = await app.request('/api/objects/m-done-quota/done', { method: 'PATCH', headers })
    expect(res.status).toBe(422)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.error).toBe('Quota exceeded')
  })

  it('does not change usage when a file with size 0 is confirmed', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 50)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 50)
    await insertFile(db, orgId, { id: 'm-done3', name: 'empty.txt', size: 0, status: 'draft' })

    await app.request('/api/objects/m-done3/done', { method: 'PATCH', headers })

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(50)
    expect(quotaRows[0].used).toBe(50)
  })

  it('returns 200 when no quota row exists (unlimited)', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // No quota row — unlimited
    await insertFile(db, orgId, { id: 'm-done-nolimit', name: 'nolimit.txt', size: 5000, status: 'draft' })

    const res = await app.request('/api/objects/m-done-nolimit/done', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })
})
