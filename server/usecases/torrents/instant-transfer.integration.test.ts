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
  it('writes the torrent tree as references to its objects without growing storage usage [spec: torrents/instant-transfer]', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db)
    await seedWorkspace(db, 'org-a', 10_000)
    await seedWorkspace(db, 'org-b', 10_000)
    const torrent = await readyTorrent(deps)
    const keys = (await deps.torrents.listFiles(torrent.id)).map((file) => file.objectKey)
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
        object: keys[0],
        storageId: STORAGE_ID,
        size: 600,
      },
      { name: 'Subs', parent: 'Media/Show S01', dirtype: 1, object: '', storageId: STORAGE_ID, size: 0 },
      {
        name: 'Show.S01E01.srt',
        parent: 'Media/Show S01/Subs',
        dirtype: 0,
        object: keys[1],
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

  it('fails with the quota error and creates nothing when the torrent does not fit [spec: torrents/transfer-over-quota]', async () => {
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

  it('replays every entry at its layout path, with media naming the files it wrote', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db)
    await seedWorkspace(db, 'org-a', 10_000)
    await seedWorkspace(db, 'org-b', 10_000)
    const show = 'Show (2019)'
    const season = `${show}/Season 01`
    const torrent = await deps.torrents.create({
      infoHash: 'ef'.repeat(20),
      storageId: STORAGE_ID,
      name: 'Show.S01.1080p',
      private: false,
      status: 'ready',
      verified: 'full',
      files: [
        {
          fileIdx: 0,
          path: 'Show.S01E01.1080p.mkv',
          layoutPath: `${season}/Show.S01E01.1080p.mkv`,
          size: 600,
          mime: 'video/x-matroska',
        },
        {
          fileIdx: 1,
          path: 'Show.S01E02.1080p.mkv',
          layoutPath: `${season}/Show.S01E02.1080p.mkv`,
          size: 500,
          mime: 'video/x-matroska',
        },
      ],
    })
    const [e01] = await deps.torrents.listFiles(torrent.id)
    // The scraper's folders and sidecars, with media naming sidecars by entry id.
    const entry = async (
      id: string,
      kind: 'folder' | 'sidecar',
      layoutPath: string,
      size = 0,
      media: Record<string, unknown> | null = null,
    ) => {
      const object = kind === 'sidecar' ? `bt/${torrent.infoHash}/${id}` : null
      await db.run(sql`
        INSERT INTO torrent_files (id, torrent_id, kind, layout_path, size, mime, storage_id, object_key, media)
        VALUES (${id}, ${torrent.id}, ${kind}, ${layoutPath}, ${size}, 'image/jpeg', ${STORAGE_ID}, ${object},
          ${media ? JSON.stringify(media) : null})
      `)
    }
    await entry('poster', 'sidecar', `${show}/poster.jpg`, 30)
    await entry('thumb', 'sidecar', `${season}/Show.S01E01.1080p-thumb.jpg`, 20)
    await entry('show', 'folder', show, 0, {
      kind: 'tvshow',
      tmdb: { id: 1399, type: 'tv' },
      title: 'Show',
      year: 2019,
      poster: 'poster',
    })
    await entry('season', 'folder', season)
    const episode = { kind: 'episode', tmdb: { id: 1399, type: 'tv' }, season: 1, episode: 1, still: 'thumb' }
    await db.run(sql`UPDATE torrent_files SET media = ${JSON.stringify(episode)} WHERE id = ${e01.id}`)

    expect(
      (
        await transferTorrent(deps, {
          torrentId: torrent.id,
          orgId: 'org-a',
          userId: USER_ID,
          targetFolder: 'Downloads',
        })
      ).ok,
    ).toBe(true)

    const rows = await db.all<{ id: string; path: string; object: string; metadata: string | null }>(sql`
      SELECT id, parent || '/' || name AS path, object, metadata FROM matters
      WHERE org_id = 'org-a' AND status = 'active' AND purged_at IS NULL ORDER BY path
    `)
    const pathOf = new Map(rows.map((row) => [row.id, row.path]))
    const tree = rows.map((row) => {
      const media = row.metadata ? (JSON.parse(row.metadata) as { media?: Record<string, string> }).media : undefined
      const image = media?.poster ?? media?.still
      return { path: row.path, object: row.object, ...(image ? { image: pathOf.get(image) } : {}) }
    })
    const bt = `bt/${torrent.infoHash}`
    expect(tree).toEqual([
      { path: '/Downloads', object: '' },
      { path: `Downloads/${show}`, object: '', image: `Downloads/${show}/poster.jpg` },
      { path: `Downloads/${season}`, object: '' },
      { path: `Downloads/${season}/Show.S01E01.1080p-thumb.jpg`, object: `${bt}/thumb` },
      {
        path: `Downloads/${season}/Show.S01E01.1080p.mkv`,
        object: e01.objectKey,
        image: `Downloads/${season}/Show.S01E01.1080p-thumb.jpg`,
      },
      { path: `Downloads/${season}/Show.S01E02.1080p.mkv`, object: expect.stringMatching(`^${bt}/`) },
      { path: `Downloads/${show}/poster.jpg`, object: `${bt}/poster` },
    ])
    expect(await orgUsed(db, 'org-a')).toBe(600 + 500 + 30 + 20)

    // A sidecar already at its name wins and is not charged; a taken video name
    // is renamed.
    await deps.matter.create({
      orgId: 'org-b',
      name: show,
      type: 'folder',
      dirtype: 1,
      object: '',
      storageId: STORAGE_ID,
      status: 'active',
    })
    await deps.matter.create({
      orgId: 'org-b',
      name: 'poster.jpg',
      type: 'image/jpeg',
      size: 7,
      dirtype: 0,
      parent: show,
      object: 'org-b/own/poster.jpg',
      storageId: STORAGE_ID,
      status: 'active',
    })
    await deps.storageUsage.reconcile('org-b', [STORAGE_ID])
    expect(
      (await transferTorrent(deps, { torrentId: torrent.id, orgId: 'org-b', userId: USER_ID, targetFolder: '' })).ok,
    ).toBe(true)
    const posters = await db.all<{ object: string }>(sql`
      SELECT object FROM matters WHERE org_id = 'org-b' AND name = 'poster.jpg' AND purged_at IS NULL
    `)
    expect(posters).toEqual([{ object: 'org-b/own/poster.jpg' }])
    expect(await orgUsed(db, 'org-b')).toBe(7 + 600 + 500 + 20)
  })
})
