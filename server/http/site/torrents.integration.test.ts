import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../../adapters/gateways/s3.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../../test/setup.js'
import { transferTorrent } from '../../usecases/torrent-cache/instant-transfer.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'cache-storage'

// Every command the S3 gateway sends, as `<Command> <Key>`.
let s3Commands: string[] = []

beforeEach(() => {
  vi.restoreAllMocks()
  s3Commands = []
  vi.spyOn(S3Service.prototype, 'createClient').mockImplementation(
    () =>
      ({
        send: async (command: { constructor: { name: string }; input: { Key?: string; Delete?: unknown } }) => {
          s3Commands.push(`${command.constructor.name} ${command.input.Key ?? JSON.stringify(command.input.Delete)}`)
          return {}
        },
      }) as unknown as ReturnType<S3Service['createClient']>,
  )
})

async function setup() {
  const testApp = await createTestApp()
  const admin = await adminHeaders(testApp.app)
  await seedProLicense(testApp.db)
  const now = Date.now()
  await testApp.db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
  return { ...testApp, admin }
}

async function cachedTorrent(
  deps: TestApp['deps'],
  infoHash: string,
  opts: {
    status?: 'downloading' | 'verifying' | 'ready' | 'invalid'
    verified?: 'full' | 'sampled' | null
    now?: Date
    downloaderId?: string
  } = {},
) {
  return deps.torrents.create({
    infoHash,
    storageId: STORAGE_ID,
    name: `Torrent ${infoHash.slice(0, 4)}`,
    private: false,
    status: opts.status ?? 'ready',
    verified: opts.verified === undefined ? 'full' : opts.verified,
    sourceDownloaderId: opts.downloaderId ?? null,
    files: [
      { fileIdx: 0, path: 'one.mkv', size: 100, mime: 'video/x-matroska' },
      { fileIdx: 1, path: 'two.mkv', size: 200, mime: 'video/x-matroska' },
    ],
    now: opts.now,
  })
}

async function adminWorkspace(db: TestApp['db']) {
  const [row] = await db.all<{ orgId: string; userId: string }>(sql`
    SELECT m.organization_id AS orgId, u.id AS userId FROM member m JOIN user u ON u.id = m.user_id
    WHERE u.email = 'admin@example.com' LIMIT 1
  `)
  const now = Date.now()
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES (${`extra-${row.orgId}`}, ${row.orgId}, 'storage', 'grant', 'test', ${`extra:${row.orgId}`}, 1000000, ${now}, NULL, 'active', '{}', ${now}, ${now})
  `)
  return row
}

type Page = {
  items: Array<{
    id: string
    infoHash: string
    name: string
    totalSize: number
    fileCount: number
    status: string
    verified: string | null
    holders: number
    lastAccessedAt: string
    sourceDownloader: { id: string; name: string | null } | null
  }>
  nextPageToken: string | null
}

describe('Admin torrents API', () => {
  it('lists cached torrents with holders, status, verification and last access, page by page [spec: torrent-cache/admin-list]', async () => {
    const { app, db, deps, admin } = await setup()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO downloaders (id, name, token_hash, token_jti, created_by, created_at, updated_at)
      VALUES ('dl-1', 'Home NAS', 'hash', 'jti-1', 'admin', ${now}, ${now})
    `)
    const held = await cachedTorrent(deps, 'a1'.repeat(20), { now: new Date(now - 3000), downloaderId: 'dl-1' })
    await cachedTorrent(deps, 'b2'.repeat(20), { status: 'verifying', verified: null, now: new Date(now - 2000) })
    const unheld = await cachedTorrent(deps, 'c3'.repeat(20), {
      verified: 'sampled',
      now: new Date(now - 1000),
      downloaderId: 'dl-gone',
    })
    const workspace = await adminWorkspace(db)
    const transfer = await transferTorrent(deps, {
      torrentId: held.id,
      orgId: workspace.orgId,
      userId: workspace.userId,
      targetFolder: 'Media',
    })
    expect(transfer.ok).toBe(true)
    // Trash one of the two held files: trashed files still hold the torrent.
    await db.run(sql`UPDATE matters SET status = 'trashed', trashed_at = ${now} WHERE name = 'one.mkv'`)

    const first = await app.request('/api/site/torrents?pageSize=2', { headers: admin })
    expect(first.status).toBe(200)
    const page1 = (await first.json()) as Page
    expect(page1.items.map((item) => item.infoHash)).toEqual(['c3'.repeat(20), 'b2'.repeat(20)])
    expect(page1.items[0]).toMatchObject({
      id: unheld.id,
      name: 'Torrent c3c3',
      totalSize: 300,
      fileCount: 2,
      status: 'ready',
      verified: 'sampled',
      holders: 0,
      lastAccessedAt: new Date(now - 1000).toISOString(),
      sourceDownloader: { id: 'dl-gone', name: null },
    })
    expect(page1.items[1]).toMatchObject({ status: 'verifying', verified: null, holders: 0, sourceDownloader: null })
    expect(page1.nextPageToken).toEqual(expect.any(String))

    const second = await app.request(
      `/api/site/torrents?pageSize=2&pageToken=${encodeURIComponent(page1.nextPageToken as string)}`,
      { headers: admin },
    )
    const page2 = (await second.json()) as Page
    expect(page2.items).toHaveLength(1)
    expect(page2.items[0]).toMatchObject({
      infoHash: 'a1'.repeat(20),
      status: 'ready',
      verified: 'full',
      holders: 2,
      sourceDownloader: { id: 'dl-1', name: 'Home NAS' },
    })
    expect(page2.nextPageToken).toBeNull()
  })

  it('evicts a torrent nobody holds and refuses a held one [spec: torrent-cache/admin-evict]', async () => {
    const { app, db, deps, admin } = await setup()
    const held = await cachedTorrent(deps, 'a1'.repeat(20))
    const unheld = await cachedTorrent(deps, 'c3'.repeat(20))
    await deps.storageUsage.reconcileStorages([STORAGE_ID])
    const workspace = await adminWorkspace(db)
    expect(
      (
        await transferTorrent(deps, {
          torrentId: held.id,
          orgId: workspace.orgId,
          userId: workspace.userId,
          targetFolder: 'Media',
        })
      ).ok,
    ).toBe(true)

    const evicted = await app.request(`/api/site/torrents/${unheld.id}`, { method: 'DELETE', headers: admin })
    expect(evicted.status).toBe(204)
    expect(await deps.torrents.get(unheld.id)).toBeNull()
    expect(await deps.torrents.listFiles(unheld.id)).toEqual([])
    const deleted = s3Commands.join('\n')
    expect(deleted).toContain(`bt/${'c3'.repeat(20)}/0`)
    expect(deleted).toContain(`bt/${'c3'.repeat(20)}/1`)
    expect(deleted).toContain(`bt/${'c3'.repeat(20)}/info`)
    expect(deleted).not.toContain('a1a1')
    const [storage] = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(300)

    const refused = await app.request(`/api/site/torrents/${held.id}`, { method: 'DELETE', headers: admin })
    expect(refused.status).toBe(409)
    const body = (await refused.json()) as { error: { message: string; details?: Array<{ reason?: string }> } }
    expect(body.error.message).toContain('2 drive files still hold this torrent')
    expect(JSON.stringify(body)).toContain('TORRENT_HELD')
    expect((await deps.torrents.get(held.id))?.status).toBe('ready')
    expect(s3Commands.join('\n')).not.toContain('a1a1')

    const missing = await app.request('/api/site/torrents/nope', { method: 'DELETE', headers: admin })
    expect(missing.status).toBe(404)
  })

  it('refuses to evict a torrent that is still downloading or verifying', async () => {
    const { app, deps, admin } = await setup()
    const verifying = await cachedTorrent(deps, 'b2'.repeat(20), { status: 'verifying', verified: null })

    const res = await app.request(`/api/site/torrents/${verifying.id}`, { method: 'DELETE', headers: admin })

    expect(res.status).toBe(409)
    expect(JSON.stringify(await res.json())).toContain('TORRENT_IN_PROGRESS')
    expect(s3Commands).toEqual([])
  })

  it('reads and saves retention and capacity, defaulting to 30 days and no capacity', async () => {
    const { app, admin } = await setup()
    const headers = { ...admin, 'Content-Type': 'application/json' }

    const defaults = await app.request('/api/site/settings/torrent-cache', { headers: admin })
    expect(await defaults.json()).toEqual({ retentionDays: 30, capacityBytes: null })

    const saved = await app.request('/api/site/settings/torrent-cache', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ retentionDays: 7, capacityBytes: 2 * 1024 ** 4 }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ retentionDays: 7, capacityBytes: 2 * 1024 ** 4 })
    const reread = await app.request('/api/site/settings/torrent-cache', { headers: admin })
    expect(await reread.json()).toEqual({ retentionDays: 7, capacityBytes: 2 * 1024 ** 4 })

    const cleared = await app.request('/api/site/settings/torrent-cache', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ retentionDays: 14, capacityBytes: null }),
    })
    expect(await cleared.json()).toEqual({ retentionDays: 14, capacityBytes: null })

    const invalid = await app.request('/api/site/settings/torrent-cache', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ retentionDays: 0, capacityBytes: null }),
    })
    expect(invalid.status).toBe(400)
  })

  it('refuses non-admins', async () => {
    const { app, deps } = await setup()
    const torrent = await cachedTorrent(deps, 'c3'.repeat(20))
    const member = await authedHeaders(app, 'member@example.com')

    const list = await app.request('/api/site/torrents', { headers: member })
    const evict = await app.request(`/api/site/torrents/${torrent.id}`, { method: 'DELETE', headers: member })
    const settings = await app.request('/api/site/settings/torrent-cache', { headers: member })
    const save = await app.request('/api/site/settings/torrent-cache', {
      method: 'PUT',
      headers: { ...member, 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: 1, capacityBytes: null }),
    })

    expect([list.status, evict.status, settings.status, save.status]).toEqual([403, 403, 403, 403])
    expect(await deps.torrents.get(torrent.id)).not.toBeNull()
  })

  it('answers 402 without the torrent_cache entitlement', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const list = await app.request('/api/site/torrents', { headers: admin })
    const settings = await app.request('/api/site/settings/torrent-cache', { headers: admin })

    expect(list.status).toBe(402)
    expect(settings.status).toBe(402)
  })
})
