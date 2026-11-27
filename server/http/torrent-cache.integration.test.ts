import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { encodeDavPathSegment } from '../domain/webdav.js'
import { authedHeaders, createTestApp } from '../test/setup.js'
import { evictTorrentCache } from '../usecases/torrent-cache/eviction.js'
import { transferTorrent } from '../usecases/torrent-cache/instant-transfer.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'cache-storage'
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
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key) => {
    s3Commands.push(`PutObjectCommand ${key}`)
    return 0
  })
})

function cacheCommands(): string[] {
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

async function cachedTorrent(
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

describe('torrent cache references', () => {
  it('purges, copies, renames, and moves transferred files without touching the cached bytes [spec: torrent-cache/cached-files-keep-bytes]', async () => {
    const { app, db, deps, auth } = await createTestApp()
    const headers = { ...(await authedHeaders(app)), 'Content-Type': 'application/json' }
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const torrent = await cachedTorrent(deps, 'a1'.repeat(20), [
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

    const cachedKey = `bt/${'a1'.repeat(20)}/1`
    expect(await fileRow(db, workspace.orgId, 'renamed.mkv')).toEqual([
      { id: two.id, object: cachedKey, parent: '', status: 'active' },
    ])
    expect((await fileRow(db, workspace.orgId, copied.name))[0]).toMatchObject({ id: copied.id, object: cachedKey })
    expect((await fileRow(db, workspace.orgId, 'dav-copy.mkv'))[0]).toMatchObject({ object: cachedKey })
    expect(cacheCommands()).toEqual([])
    expect(await deps.torrents.listFiles(torrent.id)).toHaveLength(2)
    // The cached bytes are counted once, however many files hold them.
    expect(await storageUsed(db)).toBe(300)
  })

  it('rejects a WebDAV overwrite of a transferred file [spec: torrent-cache/cached-files-read-only]', async () => {
    const { app, db, deps, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const torrent = await cachedTorrent(deps, 'b2'.repeat(20), [{ path: 'movie.mkv', size: 50 }])
    await transferTorrent(deps, {
      torrentId: torrent.id,
      orgId: workspace.orgId,
      userId: workspace.userId,
      targetFolder: '',
    })
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const { key } = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId: workspace.userId, permissions: { objects: ['read', 'create', 'update'] } },
    })) as { key: string }

    const res = await app.request(`/dav/${workspace.slug}/${encodeDavPathSegment(torrent.name)}/movie.mkv`, {
      method: 'PUT',
      headers: basicHeaders(workspace.email, key, { 'Content-Type': 'video/x-matroska', 'Content-Length': '9' }),
      body: 'new bytes',
    })

    expect(res.status).toBe(409)
    expect(await fileRow(db, workspace.orgId, 'movie.mkv')).toMatchObject([{ object: `bt/${'b2'.repeat(20)}/0` }])
    expect(s3Commands.filter((command) => command.startsWith('PutObjectCommand'))).toEqual([])
  })
})

describe('torrent cache eviction', () => {
  it('deletes only torrents no drive file holds once their retention has passed [spec: torrent-cache/eviction]', async () => {
    const { app, db, deps } = await createTestApp()
    const headers = await authedHeaders(app)
    await seedStorage(db)
    const workspace = await personalWorkspace(db)
    const now = new Date()
    const monthAgo = new Date(now.getTime() - 31 * DAY)
    const unheld = await cachedTorrent(deps, 'c3'.repeat(20), [{ path: 'unheld.mkv', size: 10 }], monthAgo)
    const trashed = await cachedTorrent(deps, 'd4'.repeat(20), [{ path: 'trashed.mkv', size: 20 }], monthAgo)
    const live = await cachedTorrent(deps, 'e5'.repeat(20), [{ path: 'live.mkv', size: 40 }], monthAgo)
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

    expect(await evictTorrentCache(deps, now)).toBe(1)

    const unheldHash = 'c3'.repeat(20)
    expect(cacheCommands().sort()).toEqual(
      [
        `DeleteObjectCommand bt/${unheldHash}/0`,
        `DeleteObjectCommand bt/${unheldHash}/info`,
        `DeleteObjectCommand bt/${unheldHash}/layout.json`,
      ].sort(),
    )
    expect(await deps.torrents.get(unheld.id)).toBeNull()
    expect(await deps.torrents.listFiles(unheld.id)).toEqual([])
    expect(await deps.torrents.get(trashed.id)).toMatchObject({ status: 'ready' })
    expect(await deps.torrents.get(live.id)).toMatchObject({ status: 'ready' })
    expect(await storageUsed(db)).toBe(60)
  })
})

describe('workspace torrent folder', () => {
  async function member(app: TestApp['app'], db: TestApp['db'], orgId: string, email: string, role: string) {
    const headers = await authedHeaders(app, email)
    const [{ userId }] = await db.all<{ userId: string }>(sql`SELECT id AS userId FROM user WHERE email = ${email}`)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role) VALUES (${`member-${role}`}, ${orgId}, ${userId}, ${role})
    `)
    const active = await app.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId }),
    })
    expect(active.status).toBe(200)
    const cookie = active.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    return { ...headers, Cookie: cookie || headers.Cookie, 'Content-Type': 'application/json' }
  }

  it('reads Media by default and lets only admins change it [spec: torrent-cache/workspace-folder]', async () => {
    const { app, db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
      VALUES ('team-1', 'Team', 'team', '{}', ${now}, ${now})
    `)
    const admin = await member(app, db, 'team-1', 'admin@example.com', 'admin')
    const editor = await member(app, db, 'team-1', 'editor@example.com', 'editor')

    for (const headers of [admin, editor]) {
      const res = await app.request('/api/torrent-cache/config', { headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ folder: 'Media' })
    }

    const saved = await app.request('/api/torrent-cache/config', {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ folder: ' Movies/Incoming/ ' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ folder: 'Movies/Incoming' })

    const refused = await app.request('/api/torrent-cache/config', {
      method: 'PUT',
      headers: editor,
      body: JSON.stringify({ folder: 'Elsewhere' }),
    })
    expect(refused.status).toBe(403)

    const read = await app.request('/api/torrent-cache/config', { headers: editor })
    expect(await read.json()).toEqual({ folder: 'Movies/Incoming' })
  })
})
