import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { orgQuotaEntitlements, orgQuotas } from '../db/schema.js'
import { currentTrafficPeriod } from '../domain/quota.js'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

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
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota,
      used,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: currentTrafficPeriod(),
    })
  }
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quota_entitlements
    SET status = 'revoked', updated_at = ${now}
    WHERE org_id = ${orgId}
      AND resource_type = 'storage'
      AND entitlement_type = 'plan'
      AND status = 'active'
  `)
  if (quota > 0) {
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        (${nanoid()}, ${orgId}, 'storage', 'plan', 'test', ${`test-storage-plan:${orgId}:${nanoid()}`}, ${quota}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
    `)
  }
}

async function addStorageEntitlement(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  bytes: number,
) {
  const now = new Date()
  await db.insert(orgQuotaEntitlements).values({
    id: nanoid(),
    orgId,
    resourceType: 'storage',
    source: 'test',
    sourceId: nanoid(),
    bytes,
    startsAt: now,
    expiresAt: null,
    status: 'active',
    metadata: null,
    createdAt: now,
    updatedAt: now,
  })
}

// ─── POST /api/objects/copy — quota enforcement ──────────────────────────

describe('POST /api/objects/copy — quota enforcement', () => {
  it('returns 422 when copying a file would exceed quota', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota = 500, used = 450, file size = 100 → copy would exceed
    await setOrgQuota(db, orgId, 500, 450)
    await insertFile(db, orgId, { id: 'm-copy-over', name: 'big.txt', size: 100 })

    const res = await app.request('/api/objects/m-copy-over/copies', {
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

    const res = await app.request('/api/objects/m-copy-ok/copies', {
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

    await app.request('/api/objects/m-copy-st/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(storageRows[0].used).toBe(200)
  })

  it('rolls back usage when S3 copy fails after quota reservation', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 100)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, { id: 'm-copy-s3-fail', name: 'fail.txt', size: 200 })
    vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

    const res = await app.request('/api/objects/m-copy-s3-fail/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Archive' }),
    })

    expect(res.status).toBe(500)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(100)
    expect(quotaRows[0].used).toBe(100)
  })

  it('rolls back usage when copy fails on name conflict after quota reservation', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 100)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, { id: 'm-copy-conflict', name: 'conflict.txt', size: 200 })

    const res = await app.request('/api/objects/m-copy-conflict/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '', onConflict: 'fail' }),
    })

    expect(res.status).toBe(409)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(100)
    expect(quotaRows[0].used).toBe(100)
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

    const res = await app.request('/api/objects/m-zero/copies', {
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

    const res = await app.request('/api/objects/m-copy-nolimit/copies', {
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

    const res = await app.request('/api/objects/m-copy-qlimit/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 404 when source file does not exist', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)

    const res = await app.request('/api/objects/nonexistent/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('trash and purge — storage usage accounting', () => {
  it('does not change usage when an active file is moved to trash', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 300)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 300)
    await insertFile(db, orgId, { id: 'm-trash-usage', name: 'keep-accounted.txt', size: 300 })

    const res = await app.request('/api/objects/m-trash-usage/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'trashed' }),
    })

    expect(res.status).toBe(200)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(300)
    expect(quotaRows[0].used).toBe(300)
  })

  it('emptying trash releases only purged files and keeps active file usage', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 500)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 500)
    await insertFile(db, orgId, { id: 'm-active-after-empty', name: 'active.txt', size: 300 })
    await insertFile(db, orgId, { id: 'm-trashed-empty', name: 'trashed.txt', size: 200, status: 'trashed' })

    const res = await app.request('/api/trash', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(300)
    expect(quotaRows[0].used).toBe(300)
  })

  it('emptying trash recalculates usage when counters had drifted below active file bytes', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 200)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 200)
    await insertFile(db, orgId, { id: 'm-active-drift', name: 'active.txt', size: 300 })
    await insertFile(db, orgId, { id: 'm-trashed-drift', name: 'trashed.txt', size: 200, status: 'trashed' })

    const res = await app.request('/api/trash', { method: 'DELETE', headers })

    expect(res.status).toBe(200)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(storageRows[0].used).toBe(300)
    expect(quotaRows[0].used).toBe(300)
  })
})

describe('GET /api/objects/:id — traffic quota enforcement', () => {
  it('returns download URL and consumes traffic quota when allowed', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm-download-ok', name: 'download.txt', size: 100 })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 500, traffic_used = 25, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/api/objects/m-download-ok', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(125)
  })

  it('resets stale monthly traffic period before consuming traffic', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm-download-reset', name: 'download.txt', size: 100 })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 500, traffic_used = 500, traffic_period = '1970-01'
      WHERE org_id = ${orgId}
    `)

    const res = await app.request('/api/objects/m-download-reset', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')

    const rows = await db.all<{ trafficUsed: number; trafficPeriod: string }>(
      sql`SELECT traffic_used AS trafficUsed, traffic_period AS trafficPeriod FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0]).toEqual({ trafficUsed: 100, trafficPeriod })
  })

  it('refunds traffic when download URL signing fails', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm-download-sign-fail', name: 'download.txt', size: 100 })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 500, traffic_used = 25, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('sign failed'))

    const res = await app.request('/api/objects/m-download-sign-fail', { headers })
    expect(res.status).toBe(500)

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(25)
  })

  it('returns 422 when download traffic quota is exhausted', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm-download-over', name: 'download.txt', size: 100 })
    const trafficPeriod = currentTrafficPeriod()
    await db.run(sql`
      UPDATE org_quotas
      SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
      WHERE org_id = ${orgId}
    `)
    const now = Date.now()
    await db.run(sql`
      UPDATE org_quota_entitlements
      SET status = 'revoked', updated_at = ${now}
      WHERE org_id = ${orgId}
        AND resource_type = 'traffic'
        AND entitlement_type = 'plan'
        AND status = 'active'
    `)
    await db.run(sql`
      INSERT INTO org_quota_entitlements
        (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
      VALUES
        (${nanoid()}, ${orgId}, 'traffic', 'plan', 'test', ${`test-traffic-plan:${orgId}`}, 50, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
    `)

    const res = await app.request('/api/objects/m-download-over', { headers })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'Traffic quota exceeded' })
    expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(rows[0].trafficUsed).toBe(0)
  })
})

// ─── PATCH /api/objects/:id (action: confirm) — quota enforcement via confirmUpload ─────────

describe('PATCH /api/objects/:id (action: confirm) — quota enforcement via confirmUpload', () => {
  it('returns 200 and increments usage when quota allows', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 0)
    await insertFile(db, orgId, { id: 'm-done', name: 'uploading.txt', size: 350, status: 'draft' })

    const res = await app.request('/api/objects/m-done/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(350)
  })

  it('uses active storage entitlements when confirming upload', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 100, 90)
    await addStorageEntitlement(db, orgId, 100)
    await insertFile(db, orgId, { id: 'm-done-entitlement', name: 'entitled.txt', size: 50, status: 'draft' })

    const res = await app.request('/api/objects/m-done-entitlement/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })

    expect(res.status).toBe(200)
    const quotaRows = await db.all<{ used: number; quota: number }>(
      sql`SELECT used, quota FROM org_quotas WHERE org_id = ${orgId}`,
    )
    expect(quotaRows[0]).toEqual({ used: 140, quota: 100 })
  })

  it('enforces storage entitlements when base quota is unlimited', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 0, 90)
    await addStorageEntitlement(db, orgId, 100)
    await insertFile(db, orgId, { id: 'm-done-zero-base-entitlement', name: 'limited.txt', size: 11, status: 'draft' })

    const res = await app.request('/api/objects/m-done-zero-base-entitlement/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })

    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'Quota exceeded' })
  })

  it('returns 200 and increments storages.used when quota allows', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 100)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 10000, 100)
    await insertFile(db, orgId, { id: 'm-done2', name: 'photo.jpg', size: 400, status: 'draft' })

    await app.request('/api/objects/m-done2/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })

    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(storageRows[0].used).toBe(500)
  })

  it('returns 422 when confirming upload would exceed quota', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // quota = 100, used = 90, file size = 50 → exceeds
    await setOrgQuota(db, orgId, 100, 90)
    await insertFile(db, orgId, { id: 'm-done-quota', name: 'toobig.txt', size: 50, status: 'draft' })

    const res = await app.request('/api/objects/m-done-quota/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
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

    await app.request('/api/objects/m-done3/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })

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

    const res = await app.request('/api/objects/m-done-nolimit/status', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('replaces a same-size file at full quota — net-neutral, incumbent purged', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // Quota exactly full: the 100-byte incumbent fills the 100-byte quota.
    await insertFile(db, orgId, { id: 'incumbent', name: 'doc.txt', size: 100 })
    await setOrgQuota(db, orgId, 100, 100)

    // Create the replacement draft (incumbent stays active — overwrite deferred).
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'doc.txt',
        type: 'text/plain',
        size: 100,
        parent: '',
        dirtype: 0,
        onConflict: 'replace',
      }),
    })
    expect(createRes.status).toBe(201)
    const draft = (await createRes.json()) as { id: string }

    // Confirm with replace. Before the fix this 422'd (headroom for both copies).
    const confirmRes = await app.request(`/api/objects/${draft.id}/status`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', onConflict: 'replace' }),
    })
    expect(confirmRes.status).toBe(200)

    // Incumbent purged (overwritten, not trashed) and usage unchanged.
    const incumbent = await db.all(sql`SELECT id FROM matters WHERE id = 'incumbent'`)
    expect(incumbent).toHaveLength(0)
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    expect(quotaRows[0].used).toBe(100)
  })
})
