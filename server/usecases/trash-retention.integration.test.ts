import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createMatterRepo } from '../adapters/repos/matter.js'
import { createTestApp } from '../test/setup.js'
import { DEFAULT_TRASH_RETENTION_DAYS, purgeExpiredTrash, resolveTrashRetentionDays } from './trash-retention.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

function getMatter(db: TestDb, id: string, orgId: string) {
  return createMatterRepo(db).get(id, orgId)
}

const DAY_MS = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
})

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('st-1', 'Test S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'AKID', 'SECRET', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertOrg(db: TestDb, orgId: string) {
  await db.run(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${orgId}, 'Org', ${`org-${orgId}`}, ${Date.now()})
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${nanoid()}, ${orgId}, ${1024 * 1024}, 0, 0, 0, '1970-01')
  `)
}

async function insertFile(
  db: TestDb,
  orgId: string,
  opts: { id: string; size: number; status: 'active' | 'trashed'; trashedAt?: number },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${`${opts.id}.txt`}, 'text/plain', ${opts.size}, 0, '', ${`key/${opts.id}`}, 'st-1', ${opts.status}, ${opts.trashedAt ?? null}, ${now}, ${now})
  `)
}

async function getUsed(db: TestDb, orgId: string): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
  return rows[0]?.used ?? 0
}

describe('resolveTrashRetentionDays', () => {
  it('defaults when unset, empty, or invalid', () => {
    expect(resolveTrashRetentionDays(undefined)).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    expect(resolveTrashRetentionDays('')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    expect(resolveTrashRetentionDays('abc')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    expect(resolveTrashRetentionDays('-5')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
  })

  it('honors explicit values, including 0 (disabled)', () => {
    expect(resolveTrashRetentionDays('7')).toBe(7)
    expect(resolveTrashRetentionDays('0')).toBe(0)
  })
})

describe('purgeExpiredTrash', () => {
  it('purges trash older than the window and reclaims quota, keeping recent trash and active files', async () => {
    const { db, deps } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertOrg(db, orgId)
    const now = Date.now()
    await insertFile(db, orgId, { id: 'old', size: 100, status: 'trashed', trashedAt: now - 40 * DAY_MS })
    await insertFile(db, orgId, { id: 'recent', size: 200, status: 'trashed', trashedAt: now - 5 * DAY_MS })
    await insertFile(db, orgId, { id: 'active', size: 300, status: 'active' })

    const purged = await purgeExpiredTrash(deps, 30, now)

    expect(purged).toBe(1)
    expect(await getMatter(db, 'old', orgId)).toBeNull()
    expect((await getMatter(db, 'recent', orgId))?.status).toBe('trashed')
    expect((await getMatter(db, 'active', orgId))?.status).toBe('active')
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
    // reconcile counts active + trashed: recent(200) + active(300); old(100) freed.
    expect(await getUsed(db, orgId)).toBe(500)
  })

  it('is a no-op when retention is 0 (disabled)', async () => {
    const { db, deps } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertOrg(db, orgId)
    await insertFile(db, orgId, { id: 'old', size: 100, status: 'trashed', trashedAt: Date.now() - 400 * DAY_MS })

    const purged = await purgeExpiredTrash(deps, 0)

    expect(purged).toBe(0)
    expect(await getMatter(db, 'old', orgId)).not.toBeNull()
  })
})
