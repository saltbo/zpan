import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { encodeDavPathSegment } from '../domain/webdav.js'
import { authedHeaders, createTestApp } from '../test/setup.js'
import { evictTorrents } from '../usecases/torrents/eviction.js'
import { transferTorrent } from '../usecases/torrents/instant-transfer.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'torrent-storage'
const DAY = 24 * 60 * 60 * 1000

// Every command the S3 gateway sends, as `<Command> <Key>`.
let s3Commands: string[] = []

beforeEach(() => {
  vi.restoreAllMocks()
  s3Commands = []
  vi.spyOn(S3Service.prototype, 'createClient').mockImplementation(
    () =>
      ({
        send: async (command: { constructor: { name: string }; input: { Key?: string } }) => {
          s3Commands.push(`${command.constructor.name} ${command.input.Key ?? ''}`)
          return {}
        },
      }) as unknown as ReturnType<S3Service['createClient']>,
  )
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, _body, _type, length) => {
    s3Commands.push(`PutObjectCommand ${key}`)
    return length ?? 0
  })
  vi.spyOn(S3Service.prototype, 'listTorrentKeys').mockResolvedValue([])
})

function torrentCommands(): string[] {
  return s3Commands.filter((command) => command.includes(' bt/'))
}

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function personalWorkspace(db: TestApp['db']) {
  const [workspace] = await db.all<{ id: string; slug: string }>(sql`
    SELECT id, slug FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  const [user] = await db.all<{ id: string; email: string }>(sql`SELECT id, email FROM user LIMIT 1`)
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quota_entitlements SET status = 'revoked'
    WHERE org_id = ${workspace.id} AND resource_type = 'storage' AND entitlement_type = 'plan'
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${`plan-${workspace.id}`}, ${workspace.id}, 'storage', 'plan', 'test', ${`plan:${workspace.id}`}, 1000000, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
  return { orgId: workspace.id, slug: workspace.slug, userId: user.id, email: user.email }
}

// The object key of each file of a torrent, by file index.
async function fileKeys(deps: TestApp['deps'], torrentId: string): Promise<string[]> {
  return (await deps.torrents.listFiles(torrentId)).map((file) => file.objectKey)
}

async function seedTorrent(
  deps: TestApp['deps'],
  infoHash: string,
  files: Array<{ path: string; size: number }>,
  lastAccessedAt = new Date(),
) {
  const torrent = await deps.torrents.create({
    infoHash,
    storageId: STORAGE_ID,
    name: `Torrent ${infoHash.slice(0, 4)}`,
    private: false,
    status: 'ready',
    verified: 'full',
    files: files.map((file, fileIdx) => ({ fileIdx, ...file, mime: 'video/x-matroska' })),
    now: lastAccessedAt,
  })
  await deps.storageUsage.reconcileStorages([STORAGE_ID])
  return torrent
}

async function fileRow(db: TestApp['db'], orgId: string, name: string) {
  const rows = await db.all<{ id: string; object: string; parent: string; status: string }>(sql`
    SELECT id, object, parent, status FROM matters
    WHERE org_id = ${orgId} AND name = ${name} AND purged_at IS NULL AND trashed_at IS NULL
  `)
  return rows
}

async function storageUsed(db: TestApp['db']): Promise<number> {
  const [row] = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
  return row.used
}

function basicHeaders(username: string, password: string, extra?: Record<string, string>) {
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}`, ...extra }
}

describe('drive files that reference a torrent', () => {
  it('purges, copies, renames, and moves transferred files without touching the cached bytes [spec: torrents/transferred-files-keep-bytes]', async () => {
    const { app, db, deps, auth } = await createTestApp()
    const headers = { ...(await authedHeaders(app)), 'Content-Type': 'application/json' }
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const torrent = await seedTorrent(deps, 'a1'.repeat(20), [
      { path: 'one.mkv', size: 100 },
      { path: 'two.mkv', size: 200 },
    ])
    const transfer = await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: workspace.orgId,
      userId: workspace.userId,
      targetFolder: 'Media',
    })
    expect(transfer.ok).toBe(true)
    const [one] = await fileRow(db, workspace.orgId, 'one.mkv')
    const [two] = await fileRow(db, workspace.orgId, 'two.mkv')

    // Permanently delete one: trash, then purge from the trash.
    expect((await app.request(`/api/objects/${one.id}`, { method: 'DELETE', headers })).status).toBe(204)
    expect((await app.request(`/api/trash/objects/${one.id}`, { method: 'DELETE', headers })).status).toBe(204)
    expect(await fileRow(db, workspace.orgId, 'one.mkv')).toEqual([])

    // Copy, rename, and move the other.
    const copy = await app.request(`/api/objects/${two.id}/copies`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parent: 'Media' }),
    })
    expect(copy.status).toBe(201)
    const copied = (await copy.json()) as { id: string; name: string }
    const renamed = await app.request(`/api/objects/${two.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'renamed.mkv' }),
    })
    expect(renamed.status).toBe(200)
    const moved = await app.request(`/api/objects/${two.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ parent: '' }),
    })
    expect(moved.status).toBe(200)

    // WebDAV COPY writes another reference too.
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const { key } = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId: workspace.userId, permissions: { objects: ['read', 'create', 'update'] } },
    })) as { key: string }
    const davCopy = await app.request(`/dav/${workspace.slug}/renamed.mkv`, {
      method: 'COPY',
      headers: basicHeaders(workspace.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/dav-copy.mkv`,
      }),
    })
    expect(davCopy.status).toBe(201)

    const cachedKey = (await fileKeys(deps, torrent.id))[1]
    expect(await fileRow(db, workspace.orgId, 'renamed.mkv')).toEqual([
      { id: two.id, object: cachedKey, parent: '', status: 'active' },
    ])
    expect((await fileRow(db, workspace.orgId, copied.name))[0]).toMatchObject({ id: copied.id, object: cachedKey })
    expect((await fileRow(db, workspace.orgId, 'dav-copy.mkv'))[0]).toMatchObject({ object: cachedKey })
    expect(torrentCommands()).toEqual([])
    expect(await deps.torrents.listFiles(torrent.id)).toHaveLength(2)
    // The torrent's bytes are counted once, however many files hold them.
    expect(await storageUsed(db)).toBe(300)
  })

  it('gives an overwritten file an object of its own and leaves the torrent untouched [spec: torrents/overwrite-writes-owned-object]', async () => {
    const { app, db, deps, auth } = await createTestApp()
    const headers = { ...(await authedHeaders(app)), 'Content-Type': 'application/json' }
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const torrent = await seedTorrent(deps, 'b2'.repeat(20), [
      { path: 'movie.mkv', size: 50 },
      { path: 'extra.mkv', size: 30 },
    ])
    const keys = await fileKeys(deps, torrent.id)
    await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: workspace.orgId,
      userId: workspace.userId,
      targetFolder: '',
    })
    expect(await storageUsed(db)).toBe(80)

    // WebDAV PUT over a referencing file.
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const { key } = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId: workspace.userId, permissions: { objects: ['read', 'create', 'update'] } },
    })) as { key: string }
    const [before] = await fileRow(db, workspace.orgId, 'movie.mkv')
    // The org quota counted the reference; the storage did not, so it reserves
    // every byte of the new object (the org pays nothing net of the 50 freed).
    const increment = vi.spyOn(deps.quota, 'incrementUsageIfEffectiveQuotaAllows')
    const put = await app.request(`/dav/${workspace.slug}/${encodeDavPathSegment(torrent.name)}/movie.mkv`, {
      method: 'PUT',
      headers: basicHeaders(workspace.email, key, { 'Content-Type': 'video/x-matroska', 'Content-Length': '9' }),
      body: 'new bytes',
    })
    expect(put.status).toBe(204)
    const [overwritten] = await fileRow(db, workspace.orgId, 'movie.mkv')
    expect(overwritten.id).toBe(before.id)
    expect(overwritten.object).not.toMatch(/^bt\//)
    expect(overwritten.object.startsWith(`${workspace.orgId}/`)).toBe(true)
    expect(s3Commands).toContain(`PutObjectCommand ${overwritten.object}`)
    expect(increment).toHaveBeenLastCalledWith(workspace.orgId, STORAGE_ID, 0, true, undefined, 9)

    // A web upload that replaces the other referencing file.
    vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://upload.example.com/part')
    vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({
      size: 4,
      contentType: 'video/x-matroska',
      etag: 'abc',
    })
    const [extra] = await fileRow(db, workspace.orgId, 'extra.mkv')
    const draft = await app.request('/api/objects', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'extra.mkv',
        type: 'video/x-matroska',
        size: 4,
        parent: extra.parent,
        dirtype: 0,
        onConflict: 'replace',
      }),
    })
    expect(draft.status).toBe(201)
    const created = (await draft.json()) as { id: string; upload: { sessionId: string } }
    const completed = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
    })
    expect(completed.status).toBe(200)
    const [replaced] = await fileRow(db, workspace.orgId, 'extra.mkv')
    expect(replaced.id).toBe(created.id)
    expect(replaced.object).not.toMatch(/^bt\//)
    expect(increment).toHaveBeenLastCalledWith(workspace.orgId, STORAGE_ID, 0, true, undefined, 4)

    // The torrent's objects were never written or deleted, and still count once;
    // the storage now also holds the two owned objects.
    expect(torrentCommands()).toEqual([])
    expect(await fileKeys(deps, torrent.id)).toEqual(keys)
    expect(await deps.torrents.get(torrent.id)).toMatchObject({ status: 'ready' })
    expect(await storageUsed(db)).toBe(80 + 9 + 4)
    const [quota] = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${workspace.orgId}`)
    expect(quota.used).toBe(9 + 4)
  })
})

describe('torrent eviction', () => {
  it('deletes only torrents no drive file holds once their retention has passed [spec: torrents/eviction]', async () => {
    const { app, db, deps } = await createTestApp()
    const headers = await authedHeaders(app)
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const now = new Date()
    const monthAgo = new Date(now.getTime() - 31 * DAY)
    const unheld = await seedTorrent(deps, 'c3'.repeat(20), [{ path: 'unheld.mkv', size: 10 }], monthAgo)
    const [unheldKey] = await fileKeys(deps, unheld.id)
    const trashed = await seedTorrent(deps, 'd4'.repeat(20), [{ path: 'trashed.mkv', size: 20 }], monthAgo)
    const live = await seedTorrent(deps, 'e5'.repeat(20), [{ path: 'live.mkv', size: 40 }], monthAgo)
    for (const torrent of [trashed, live]) {
      const result = await transferTorrent(deps, {
        torrentId: torrent.id,
        orgId: workspace.orgId,
        userId: workspace.userId,
        targetFolder: '',
        now: monthAgo,
      })
      expect(result.ok).toBe(true)
    }
    const [trashedFile] = await fileRow(db, workspace.orgId, 'trashed.mkv')
    expect((await app.request(`/api/objects/${trashedFile.id}`, { method: 'DELETE', headers })).status).toBe(204)
    expect(await storageUsed(db)).toBe(70)

    expect(await evictTorrents(deps, now)).toBe(1)

    const unheldHash = 'c3'.repeat(20)
    expect(torrentCommands().sort()).toEqual(
      [`DeleteObjectCommand ${unheldKey}`, `DeleteObjectCommand bt/${unheldHash}/info`].sort(),
    )
    expect(await deps.torrents.get(unheld.id)).toBeNull()
    expect(await deps.torrents.listFiles(unheld.id)).toEqual([])
    expect(await deps.torrents.get(trashed.id)).toMatchObject({ status: 'ready' })
    expect(await deps.torrents.get(live.id)).toMatchObject({ status: 'ready' })
    expect(await storageUsed(db)).toBe(60)
  })
})
