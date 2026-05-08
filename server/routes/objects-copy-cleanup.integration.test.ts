import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { orgQuotas } from '../db/schema.js'
import { currentTrafficPeriod } from '../services/effective-quota.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

const validStorage = {
  id: 'st-copy-cleanup',
  title: 'Copy Cleanup S3',
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
  id: string,
  name: string,
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, ${name}, 'text/plain', 100, 0, '',
            'some/key.txt', ${validStorage.id}, 'active', ${now}, ${now})
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
}

describe('POST /api/objects/copy — cleanup after quota reservation', () => {
  it('rolls back reserved usage when S3 copy fails', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 50)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, 'm-copy-s3-fail', 's3-fail.txt')
    vi.spyOn(S3Service.prototype, 'copyObject').mockRejectedValueOnce(new Error('copy_failed'))

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'm-copy-s3-fail', parent: '' }),
    })
    expect(res.status).toBe(500)

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(quotaRows[0].used).toBe(100)
    expect(storageRows[0].used).toBe(50)
    expect(S3Service.prototype.deleteObject).not.toHaveBeenCalled()
  })

  it('rolls back reserved usage and deletes the copied object when copy hits a name conflict', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 50)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, 'm-copy-conflict-source', 'conflict.txt')
    await insertFile(db, orgId, 'm-copy-conflict-target', 'conflict.txt')

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'm-copy-conflict-source', parent: '', onConflict: 'fail' }),
    })
    expect(res.status).toBe(409)

    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(quotaRows[0].used).toBe(100)
    expect(storageRows[0].used).toBe(50)
    expect(S3Service.prototype.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: validStorage.id }),
      vi.mocked(S3Service.prototype.copyObject).mock.calls[0][3],
    )
    expect(vi.mocked(S3Service.prototype.deleteObject).mock.calls[0][1]).not.toBe('some/key.txt')
  })

  it('keeps reserved usage and copied object when failure happens after matter insert', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, 50)
    const orgId = await getOrgId(db)
    await setOrgQuota(db, orgId, 1000, 100)
    await insertFile(db, orgId, 'm-copy-activity-fail', 'activity-fail.txt')
    await db.run(sql`
      CREATE TRIGGER fail_object_copy_activity
      BEFORE INSERT ON activity_events
      WHEN NEW.action = 'object_copy'
      BEGIN
        SELECT RAISE(ABORT, 'activity_insert_failed');
      END
    `)

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'm-copy-activity-fail', parent: '' }),
    })
    expect(res.status).toBe(500)

    const copiedObject = vi.mocked(S3Service.prototype.copyObject).mock.calls[0][3]
    const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    const matterRows = await db.all<{ status: string }>(sql`
      SELECT status FROM matters WHERE org_id = ${orgId} AND object = ${copiedObject}
    `)
    expect(quotaRows[0].used).toBe(200)
    expect(storageRows[0].used).toBe(150)
    expect(matterRows).toEqual([{ status: 'active' }])
    expect(S3Service.prototype.deleteObject).not.toHaveBeenCalled()
  })
})
