import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../test/setup'
import { transferTorrent } from './instant-transfer'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'cache-storage'
const USER_ID = 'user-1'

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function seedWorkspace(db: TestApp['db'], orgId: string, quotaBytes: number) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`quota-${orgId}`}, ${orgId}, 0, 0, 0, 0, '2026-05')
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${`plan-${orgId}`}, ${orgId}, 'storage', 'plan', 'test', ${`plan:${orgId}`}, ${quotaBytes}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
}

async function readyTorrent(deps: TestApp['deps']) {
  const torrent = await deps.torrents.create({
    infoHash: 'AB'.repeat(20),
    storageId: STORAGE_ID,
    name: 'Show S01',
    private: false,
    status: 'ready',
    verified: 'full',
    files: [
      { fileIdx: 0, path: 'Show.S01E01.mkv', size: 600, mime: 'video/x-matroska' },
      { fileIdx: 1, path: 'Subs/Show.S01E01.srt', size: 40, mime: 'application/x-subrip' },
    ],
    now: new Date('2026-01-01T00:00:00Z'),
  })
  // Writing the cache objects is what grows the storage's used bytes.
  await deps.storageUsage.reconcileStorages([STORAGE_ID])
  return torrent
}

async function orgUsed(db: TestApp['db'], orgId: string): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
  return rows[0].used
}

async function storageUsed(db: TestApp['db']): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
  return rows[0].used
}

async function activeRows(db: TestApp['db'], orgId: string) {
  return db.all<{ name: string; parent: string; dirtype: number; object: string; storageId: string; size: number }>(sql`
    SELECT name, parent, dirtype, object, storage_id AS storageId, size FROM matters
    WHERE org_id = ${orgId} AND status = 'active' AND purged_at IS NULL
    ORDER BY parent, name
  `)
}

describe('transferTorrent', () => {
  it('writes the torrent tree as references to the cached objects without growing storage usage [spec: torrent-cache/instant-transfer]', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db)
    await seedWorkspace(db, 'org-a', 10_000)
    await seedWorkspace(db, 'org-b', 10_000)
    const torrent = await readyTorrent(deps)
    expect(await storageUsed(db)).toBe(640)
    // An existing torrent folder is reused by name, not duplicated.
    await deps.matter.create({
      orgId: 'org-a',
      name: 'Media',
      type: 'folder',
      dirtype: 1,
      object: '',
      storageId: STORAGE_ID,
      status: 'active',
    })

    const now = new Date('2026-03-01T00:00:00Z')
    const result = await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: 'org-a',
      userId: USER_ID,
      targetFolder: 'Media',
      now,
    })

    expect(result.ok).toBe(true)
    expect(await activeRows(db, 'org-a')).toEqual([
      { name: 'Media', parent: '', dirtype: 1, object: '', storageId: STORAGE_ID, size: 0 },
      { name: 'Show S01', parent: 'Media', dirtype: 1, object: '', storageId: STORAGE_ID, size: 0 },
      {
        name: 'Show.S01E01.mkv',
        parent: 'Media/Show S01',
        dirtype: 0,
        object: `bt/${'ab'.repeat(20)}/0`,
        storageId: STORAGE_ID,
        size: 600,
      },
      { name: 'Subs', parent: 'Media/Show S01', dirtype: 1, object: '', storageId: STORAGE_ID, size: 0 },
      {
        name: 'Show.S01E01.srt',
        parent: 'Media/Show S01/Subs',
        dirtype: 0,
        object: `bt/${'ab'.repeat(20)}/1`,
        storageId: STORAGE_ID,
        size: 40,
      },
    ])
    expect(await orgUsed(db, 'org-a')).toBe(640)
    expect(await storageUsed(db)).toBe(640)
    expect((await deps.torrents.get(torrent.id))?.lastAccessedAt).toEqual(now)

    // A second holder is charged the full size too, and a transfer into a taken
    // name renames the file the way uploads do; reconciling still counts the
    // cached bytes once.
    expect(
      (await transferTorrent(deps, { torrentId: torrent.id, orgId: 'org-b', userId: USER_ID, targetFolder: '' })).ok,
    ).toBe(true)
    expect(
      (await transferTorrent(deps, { torrentId: torrent.id, orgId: 'org-b', userId: USER_ID, targetFolder: '' })).ok,
    ).toBe(true)
    expect((await activeRows(db, 'org-b')).filter((row) => row.parent === 'Show S01').map((row) => row.name)).toEqual([
      'Show.S01E01 (1).mkv',
      'Show.S01E01.mkv',
      'Subs',
    ])
    expect(await orgUsed(db, 'org-b')).toBe(1280)
    await deps.storageUsage.reconcile('org-b', [STORAGE_ID])
    expect(await orgUsed(db, 'org-b')).toBe(1280)
    expect(await storageUsed(db)).toBe(640)
  })

  it('fails with the quota error and creates nothing when the torrent does not fit [spec: torrent-cache/transfer-over-quota]', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db)
    await seedWorkspace(db, 'org-small', 500)
    const torrent = await readyTorrent(deps)

    const result = await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: 'org-small',
      userId: USER_ID,
      targetFolder: 'Media',
    })

    expect(result).toMatchObject({ ok: false, error: { httpStatus: 422, text: 'Quota exceeded' } })
    expect(await activeRows(db, 'org-small')).toEqual([])
    expect(await orgUsed(db, 'org-small')).toBe(0)
    expect(await storageUsed(db)).toBe(640)
  })

  it('refuses a torrent that is not ready', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db)
    await seedWorkspace(db, 'org-a', 10_000)
    const torrent = await deps.torrents.create({
      infoHash: 'cd'.repeat(20),
      storageId: STORAGE_ID,
      name: 'movie.mkv',
      private: false,
      status: 'downloading',
      files: [{ fileIdx: 0, path: 'movie.mkv', size: 10, mime: 'video/x-matroska' }],
    })

    const result = await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: 'org-a',
      userId: USER_ID,
      targetFolder: '',
    })

    expect(result).toMatchObject({ ok: false, error: { httpStatus: 409 } })
    expect(
      await transferTorrent(deps, { torrentId: 'missing', orgId: 'org-a', userId: USER_ID, targetFolder: '' }),
    ).toMatchObject({
      ok: false,
      error: { httpStatus: 404 },
    })
  })
})
