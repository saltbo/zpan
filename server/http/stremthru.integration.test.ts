import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'
import { transferTorrent } from '../usecases/torrents/instant-transfer.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const STORAGE_ID = 'stremthru-storage'
const CACHED_HASH = 'ab'.repeat(20)
const UNKNOWN_HASH = 'cd'.repeat(20)
const VIDEO = new TextEncoder().encode('video bytes of the first episode')
const SUBTITLE = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n')

// An in-memory bucket: a presigned download URL names the object, and fetching
// it in the test reads that object's bytes.
let objects: Map<string, Uint8Array>
// The object keys of the ready torrent's files, by file index.
let cachedKeys: string[]

beforeEach(() => {
  vi.restoreAllMocks()
  objects = new Map()
  cachedKeys = []
  let signed = 0
  vi.spyOn(S3Service.prototype, 'presignDownload').mockImplementation(
    async (_storage, key, filename, ttl) =>
      `mem://get/${key}?name=${encodeURIComponent(filename)}&ttl=${ttl}&n=${++signed}`,
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function download(url: string): Uint8Array | undefined {
  const match = /^mem:\/\/get\/([^?]+)/.exec(url)
  return match ? objects.get(match[1]) : undefined
}

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function workspace(ctx: TestApp, email: string) {
  const headers = { ...(await authedHeaders(ctx.app, email)), 'Content-Type': 'application/json' }
  const [row] = await ctx.db.all<{ orgId: string; userId: string }>(sql`
    SELECT o.id AS orgId, u.id AS userId FROM organization o
    JOIN member m ON m.organization_id = o.id
    JOIN user u ON u.id = m.user_id
    WHERE u.email = ${email} AND o.metadata LIKE '%"type":"personal"%'
  `)
  const now = Date.now()
  await ctx.db.run(sql`
    UPDATE org_quota_entitlements SET status = 'revoked'
    WHERE org_id = ${row.orgId} AND resource_type = 'storage' AND entitlement_type = 'plan'
  `)
  await ctx.db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
    VALUES
      (${`plan-${row.orgId}`}, ${row.orgId}, 'storage', 'plan', 'test', ${`plan:${row.orgId}`}, 100000000, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
  `)
  return { headers, ...row }
}

async function createKey(ctx: TestApp, headers: Record<string, string>, orgId: string, configId = 'stremthru') {
  const res = await ctx.app.request('/api/auth/api-key/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ configId, name: 'MediaFusion', organizationId: orgId }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { id: string; key: string }
}

async function readyTorrent(deps: TestApp['deps']) {
  const torrent = await deps.torrents.create({
    infoHash: CACHED_HASH,
    storageId: STORAGE_ID,
    name: 'Show S01',
    private: false,
    status: 'ready',
    verified: 'full',
    files: [
      { fileIdx: 0, path: 'Show.S01E01.mkv', size: VIDEO.length, mime: 'video/x-matroska' },
      { fileIdx: 1, path: 'Subs/Show.S01E01.srt', size: SUBTITLE.length, mime: 'application/x-subrip' },
    ],
  })
  cachedKeys = (await deps.torrents.listFiles(torrent.id)).map((file) => file.objectKey)
  objects.set(cachedKeys[0], VIDEO)
  objects.set(cachedKeys[1], SUBTITLE)
  return torrent
}

async function setup(options: { licensed?: boolean } = {}) {
  const ctx = await createTestApp()
  if (options.licensed !== false) await seedProLicense(ctx.db)
  await seedStorage(ctx.db)
  const owner = await workspace(ctx, 'stremthru-owner@example.com')
  const key = await createKey(ctx, owner.headers, owner.orgId)
  const torrent = await readyTorrent(ctx.deps)
  // MediaFusion's store header pair; the store name is one it lists and ZPan ignores.
  const store = {
    'X-StremThru-Store-Name': 'torbox',
    'X-StremThru-Store-Authorization': `Bearer ${key.key}`,
  }
  const call = (path: string, init: RequestInit = {}) =>
    ctx.app.request(`/stremthru${path}`, {
      ...init,
      headers: { ...store, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  return { ...ctx, owner, key, torrent, store, call }
}

type Torz = {
  id: string
  hash: string
  name: string
  size: number
  status: string
  files: Array<{ index: number; link?: string; name: string; path: string; size: number }>
  added_at: string
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function activeFiles(db: TestApp['db'], orgId: string) {
  return db.all<{ id: string; name: string; parent: string; object: string; trashedAt: number | null }>(sql`
    SELECT id, name, parent, object, trashed_at AS trashedAt FROM matters
    WHERE org_id = ${orgId} AND dirtype = 0 AND status = 'active' AND purged_at IS NULL
    ORDER BY parent, name
  `)
}

async function trafficUsed(db: TestApp['db'], orgId: string): Promise<number> {
  const rows = await db.all<{ used: number }>(sql`SELECT traffic_used AS used FROM org_quotas WHERE org_id = ${orgId}`)
  return rows[0]?.used ?? 0
}

describe('StremThru Store API', () => {
  it('reports a ready torrent as cached with its files and an unknown hash as unknown [spec: torrents/stremthru-check]', async () => {
    const { call } = await setup()

    const res = await call(`/v0/store/torz/check?hash=${CACHED_HASH},${UNKNOWN_HASH}&sid=tt0903747:1:1`)

    expect(res.status).toBe(200)
    const body = await json<{ data: { items: Array<{ hash: string; status: string; files: unknown[] }> } }>(res)
    expect(body.data.items).toEqual([
      {
        hash: CACHED_HASH,
        magnet: `magnet:?xt=urn:btih:${CACHED_HASH}`,
        status: 'cached',
        files: [
          { index: 0, name: 'Show.S01E01.mkv', path: '/Show.S01E01.mkv', size: VIDEO.length },
          { index: 1, name: 'Show.S01E01.srt', path: '/Subs/Show.S01E01.srt', size: SUBTITLE.length },
        ],
      },
      { hash: UNKNOWN_HASH, magnet: `magnet:?xt=urn:btih:${UNKNOWN_HASH}`, status: 'unknown', files: [] },
    ])
  })

  it('does not report torrents that are still downloading or verifying as cached', async () => {
    const { call, deps, torrent } = await setup()
    await deps.torrents.transition(torrent.id, ['ready'], 'verifying')

    const res = await call(`/v0/store/torz/check?hash=${CACHED_HASH}`)

    const body = await json<{ data: { items: Array<{ status: string }> } }>(res)
    expect(body.data.items.map((item) => item.status)).toEqual(['unknown'])
  })

  it('rejects an empty check and more than 500 hashes', async () => {
    const { call } = await setup()

    const empty = await call('/v0/store/torz/check')
    const tooMany = await call(`/v0/store/torz/check?hash=${Array.from({ length: 501 }, () => UNKNOWN_HASH).join(',')}`)

    expect(empty.status).toBe(400)
    expect(await json(empty)).toEqual({ error: { code: 'BAD_REQUEST', message: 'At least one hash is required' } })
    expect(tooMany.status).toBe(400)
  })

  it('transfers a cached torrent on add and generates a link that downloads the chosen file [spec: torrents/stremthru-add-and-play]', async () => {
    const { call, db, owner } = await setup()

    const added = await call('/v0/store/torz', {
      method: 'POST',
      body: JSON.stringify({ link: `magnet:?xt=urn:btih:${CACHED_HASH}&dn=Show` }),
    })

    expect(added.status).toBe(201)
    const torz = (await json<{ data: Torz }>(added)).data
    expect(torz).toMatchObject({
      hash: CACHED_HASH,
      name: 'Show S01',
      status: 'downloaded',
      size: VIDEO.length + SUBTITLE.length,
    })
    expect(torz.files.map((file) => [file.index, file.name, typeof file.link])).toEqual([
      [0, 'Show.S01E01.mkv', 'string'],
      [1, 'Show.S01E01.srt', 'string'],
    ])
    expect(await activeFiles(db, owner.orgId)).toEqual([
      expect.objectContaining({ name: 'Show.S01E01.mkv', parent: 'Media/Show S01', object: cachedKeys[0] }),
      expect.objectContaining({
        name: 'Show.S01E01.srt',
        parent: 'Media/Show S01/Subs',
        object: cachedKeys[1],
      }),
    ])

    const generated = await call('/v0/store/torz/link/generate', {
      method: 'POST',
      body: JSON.stringify({ link: torz.files[0].link }),
    })

    expect(generated.status).toBe(200)
    const link = (await json<{ data: { link: string } }>(generated)).data.link
    expect(download(link)).toEqual(VIDEO)
    expect(link).toContain('name=Show.S01E01.mkv')
    expect(link).toContain(`ttl=${12 * 60 * 60}`)

    // Adding the same magnet again returns the same item without a second transfer.
    const again = await call('/v0/store/torz', {
      method: 'POST',
      body: JSON.stringify({ link: `magnet:?xt=urn:btih:${CACHED_HASH}` }),
    })
    expect((await json<{ data: Torz }>(again)).data.id).toBe(torz.id)
    expect(await activeFiles(db, owner.orgId)).toHaveLength(2)
  })

  it('queues a torrent that is not cached and lists and gets it', async () => {
    const { call } = await setup()

    const added = await call('/v0/store/torz', {
      method: 'POST',
      body: JSON.stringify({ link: `magnet:?xt=urn:btih:${UNKNOWN_HASH}` }),
    })

    const torz = (await json<{ data: Torz }>(added)).data
    expect(torz).toMatchObject({ hash: UNKNOWN_HASH, status: 'queued', files: [] })
    const got = await json<{ data: Torz }>(await call(`/v0/store/torz/${torz.id}`))
    expect(got.data).toMatchObject({ id: torz.id, status: 'queued' })
    const listed = await json<{ data: { items: Torz[]; total_items: number } }>(await call('/v0/store/torz'))
    expect(listed.data.total_items).toBe(1)
    expect(listed.data.items[0]).toMatchObject({ id: torz.id, hash: UNKNOWN_HASH, status: 'queued' })
  })

  it('returns the issued link again within its lifetime and charges traffic once [spec: torrents/stremthru-link-metered-once]', async () => {
    const start = Date.now()
    const hour = 60 * 60 * 1000
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(start)
    const { call, db, owner } = await setup()
    const torz = (
      await json<{ data: Torz }>(
        await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: CACHED_HASH }) }),
      )
    ).data
    const generate = async () =>
      (
        await json<{ data: { link: string } }>(
          await call('/v0/store/torz/link/generate', {
            method: 'POST',
            body: JSON.stringify({ link: torz.files[0].link }),
          }),
        )
      ).data.link

    const first = await generate()
    vi.setSystemTime(start + hour)
    // The test license certificate lives an hour; renew it as a bound instance would.
    await seedProLicense(db)
    const second = await generate()

    expect(second).toBe(first)
    expect(await trafficUsed(db, owner.orgId)).toBe(VIDEO.length)
    const audits = await db.all<{ action: string; metadata: string }>(sql`
      SELECT action, metadata FROM audit_events WHERE org_id = ${owner.orgId} AND action = 'object_download'
    `)
    expect(audits).toHaveLength(1)
    expect(JSON.parse(audits[0].metadata)).toMatchObject({ source: 'stremthru', bytes: VIDEO.length })

    // With an hour or less left, the next request issues and charges a new link.
    vi.setSystemTime(start + 11 * hour)
    await seedProLicense(db)
    const third = await generate()
    expect(third).not.toBe(first)
    expect(await trafficUsed(db, owner.orgId)).toBe(VIDEO.length * 2)
  })

  it('moves the files of a removed torrent to the trash and keeps the cached torrent [spec: torrents/stremthru-remove-trashes]', async () => {
    const { call, db, deps, owner, torrent } = await setup()
    const torz = (
      await json<{ data: Torz }>(
        await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: CACHED_HASH }) }),
      )
    ).data

    const removed = await call(`/v0/store/torz/${torz.id}`, { method: 'DELETE' })

    expect(removed.status).toBe(200)
    const files = await activeFiles(db, owner.orgId)
    expect(files).toHaveLength(2)
    expect(files.every((file) => file.trashedAt !== null)).toBe(true)
    const trashRoots = await deps.matter.listTrashedRoots(owner.orgId)
    expect(trashRoots.map((matter) => matter.name)).toEqual(['Show S01'])
    expect(await deps.torrents.get(torrent.id)).toMatchObject({ status: 'ready' })
    expect(objects.has(cachedKeys[0])).toBe(true)
    const listed = await json<{ data: { items: Torz[]; total_items: number } }>(await call('/v0/store/torz'))
    expect(listed.data.total_items).toBe(0)
    expect((await call(`/v0/store/torz/${torz.id}`)).status).toBe(404)

    // A link to a trashed file no longer resolves.
    const stale = await call('/v0/store/torz/link/generate', {
      method: 'POST',
      body: JSON.stringify({ link: torz.files[0].link }),
    })
    expect(stale.status).toBe(404)
    expect(await json(stale)).toEqual({ error: { code: 'NOT_FOUND', message: 'File not found' } })
  })

  it('answers missing and revoked keys with UNAUTHORIZED and an unlicensed instance with PAYMENT_REQUIRED [spec: torrents/stremthru-auth]', async () => {
    const licensed = await setup()
    const missing = await licensed.app.request('/stremthru/v0/store/user')
    const revoke = await licensed.app.request('/api/auth/api-key/delete', {
      method: 'POST',
      headers: licensed.owner.headers,
      body: JSON.stringify({ configId: 'stremthru', keyId: licensed.key.id }),
    })
    expect(revoke.status).toBe(200)
    const revoked = await licensed.call('/v0/store/user')

    const unlicensed = await setup({ licensed: false })
    const unpaid = await unlicensed.call('/v0/store/user')

    expect(missing.status).toBe(401)
    expect(await json(missing)).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Missing store token' } })
    expect(revoked.status).toBe(401)
    expect(await json(revoked)).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    expect(unpaid.status).toBe(402)
    expect(await json(unpaid)).toMatchObject({ error: { code: 'PAYMENT_REQUIRED' } })
  })

  it('accepts the key from the Authorization header and refuses keys of other templates', async () => {
    const ctx = await setup()
    const viaAuthorization = await ctx.app.request('/stremthru/v0/store/user', {
      headers: { Authorization: `Bearer ${ctx.key.key}` },
    })
    const other = await createKey(ctx, ctx.owner.headers, ctx.owner.orgId, 'remote-download')
    const foreign = await ctx.app.request('/stremthru/v0/store/user', {
      headers: { 'X-StremThru-Store-Authorization': `Bearer ${other.key}` },
    })

    expect(viaAuthorization.status).toBe(200)
    expect(await json(viaAuthorization)).toEqual({
      data: { id: ctx.owner.userId, email: '', subscription_status: 'premium', has_usenet: false },
    })
    expect(foreign.status).toBe(401)
  })

  it('keeps a StremThru key out of every other API and out of request logs', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const bearer = { Authorization: `Bearer ${ctx.key.key}` }

    const objectsRes = await ctx.app.request('/api/objects?parent=', { headers: bearer })
    const tasks = await ctx.app.request('/api/downloads/tasks', { headers: bearer })
    const dav = await ctx.app.request('/dav/', {
      method: 'PROPFIND',
      headers: { Authorization: `Basic ${btoa(`stremthru-owner@example.com:${ctx.key.key}`)}` },
    })
    const store = await ctx.call(`/v0/store/torz/check?hash=${CACHED_HASH}`)

    expect(objectsRes.status).toBe(403)
    expect(tasks.status).toBe(403)
    expect(dav.status).toBe(401)
    expect(store.status).toBe(200)
    const lines = log.mock.calls.map((args) => args.join(' '))
    expect(lines.some((line) => line.includes('path="/stremthru/v0/store/torz/check"'))).toBe(true)
    expect(lines.some((line) => line.includes(ctx.key.key))).toBe(false)
  })

  it('refuses a key whose user left the workspace and a link from another workspace', async () => {
    const ctx = await setup()
    const torz = (
      await json<{ data: Torz }>(
        await ctx.call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link: CACHED_HASH }) }),
      )
    ).data
    const other = await workspace(ctx, 'stremthru-other@example.com')
    const otherKey = await createKey(ctx, other.headers, other.orgId)

    const foreignLink = await ctx.app.request('/stremthru/v0/store/torz/link/generate', {
      method: 'POST',
      headers: { 'X-StremThru-Store-Authorization': `Bearer ${otherKey.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ link: torz.files[0].link }),
    })
    const foreignTorz = await ctx.app.request(`/stremthru/v0/store/torz/${torz.id}`, {
      headers: { 'X-StremThru-Store-Authorization': `Bearer ${otherKey.key}` },
    })
    const badLink = await ctx.call('/v0/store/torz/link/generate', {
      method: 'POST',
      body: JSON.stringify({ link: 'https://example.com/not-ours' }),
    })
    await ctx.db.run(sql`DELETE FROM member WHERE organization_id = ${ctx.owner.orgId}`)
    await ctx.db.run(sql`UPDATE organization SET metadata = '{}' WHERE id = ${ctx.owner.orgId}`)
    const leftUser = await ctx.call('/v0/store/user')

    expect(foreignLink.status).toBe(404)
    expect(foreignTorz.status).toBe(404)
    expect(badLink.status).toBe(400)
    expect(leftUser.status).toBe(403)
    expect(await json(leftUser)).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })
})

describe('StremThru removal and re-adding', () => {
  async function add(call: Awaited<ReturnType<typeof setup>>['call'], link: string) {
    return (
      await json<{ data: Torz }>(await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({ link }) }))
    ).data
  }

  it('trashes only the torrent files when the folder also holds other files, and leaves copies elsewhere', async () => {
    const ctx = await setup()
    const torz = await add(ctx.call, CACHED_HASH)
    // The same torrent transferred elsewhere in the workspace, outside the torrent folder.
    const copy = await transferTorrent(ctx.deps, {
      torrentId: ctx.torrent.id,
      orgId: ctx.owner.orgId,
      userId: ctx.owner.userId,
      targetFolder: 'Elsewhere',
    })
    expect(copy.ok).toBe(true)
    await ctx.deps.matter.create({
      orgId: ctx.owner.orgId,
      name: 'notes.txt',
      type: 'text/plain',
      size: 1,
      parent: 'Media/Show S01',
      object: 'org/user/notes.txt',
      storageId: STORAGE_ID,
      status: 'active',
    })
    // A file the user moved straight into the torrent folder still belongs to the item.
    const subtitle = (await activeFiles(ctx.db, ctx.owner.orgId)).find(
      (file) => file.parent === 'Media/Show S01/Subs' && file.name === 'Show.S01E01.srt',
    )
    await ctx.deps.matter.update(subtitle?.id ?? '', ctx.owner.orgId, { parent: 'Media' })

    const listed = await json<{ data: Torz }>(await ctx.call(`/v0/store/torz/${torz.id}`))
    expect(listed.data.files.map((file) => typeof file.link)).toEqual(['string', 'string'])
    const removed = await ctx.call(`/v0/store/torz/${torz.id}`, { method: 'DELETE' })

    expect(removed.status).toBe(200)
    const live = (await activeFiles(ctx.db, ctx.owner.orgId)).filter((file) => file.trashedAt === null)
    expect(live.map((file) => `${file.parent}/${file.name}`).sort()).toEqual([
      'Elsewhere/Show S01/Show.S01E01.mkv',
      'Elsewhere/Show S01/Subs/Show.S01E01.srt',
      'Media/Show S01/notes.txt',
    ])
  })

  it('trashes the lone file of a single-file torrent', async () => {
    const ctx = await setup()
    const single = 'ef'.repeat(20)
    await ctx.deps.torrents.create({
      infoHash: single,
      storageId: STORAGE_ID,
      name: 'Movie.mkv',
      private: true,
      status: 'ready',
      verified: 'sampled',
      files: [{ fileIdx: 0, path: 'Movie.mkv', size: 5, mime: 'video/x-matroska' }],
    })
    const torz = await add(ctx.call, single)
    expect(torz).toMatchObject({ name: 'Movie.mkv', private: true, files: [{ index: 0, path: '/Movie.mkv' }] })

    await ctx.call(`/v0/store/torz/${torz.id}`, { method: 'DELETE' })

    const files = await activeFiles(ctx.db, ctx.owner.orgId)
    expect(files).toEqual([expect.objectContaining({ name: 'Movie.mkv', parent: 'Media' })])
    expect(files[0].trashedAt).not.toBeNull()
  })

  it('cancels and removes a torrent that is still queued', async () => {
    const ctx = await setup()
    const torz = await add(ctx.call, UNKNOWN_HASH)
    // An item still in progress is returned again rather than added twice.
    expect((await add(ctx.call, UNKNOWN_HASH)).id).toBe(torz.id)

    const removed = await ctx.call(`/v0/store/torz/${torz.id}`, { method: 'DELETE' })

    expect(removed.status).toBe(200)
    expect((await ctx.call(`/v0/store/torz/${torz.id}`)).status).toBe(404)
  })

  it('transfers again when a file of the earlier transfer was trashed by hand', async () => {
    const ctx = await setup()
    const first = await add(ctx.call, CACHED_HASH)
    const video = (await activeFiles(ctx.db, ctx.owner.orgId)).find((file) => file.name === 'Show.S01E01.mkv')
    await ctx.deps.matter.trash(ctx.owner.orgId, video?.id ?? '')

    const second = await add(ctx.call, CACHED_HASH)

    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('downloaded')
  })

  it('refunds traffic and answers INTERNAL_SERVER_ERROR when the link cannot be signed', async () => {
    const ctx = await setup()
    const torz = await add(ctx.call, CACHED_HASH)
    vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('signing failed'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await ctx.call('/v0/store/torz/link/generate', {
      method: 'POST',
      body: JSON.stringify({ link: torz.files[0].link }),
    })

    expect(res.status).toBe(500)
    expect(await json(res)).toEqual({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } })
    expect(await trafficUsed(ctx.db, ctx.owner.orgId)).toBe(0)
  })

  it('reads form-encoded bodies and rejects malformed JSON', async () => {
    const ctx = await setup()

    const form = await ctx.call('/v0/store/magnets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${CACHED_HASH}` }).toString(),
    })
    const malformed = await ctx.call('/v0/store/torz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })

    expect(form.status).toBe(201)
    expect((await json<{ data: Torz }>(form)).data.status).toBe('downloaded')
    expect(malformed.status).toBe(400)
    expect(await json(malformed)).toEqual({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } })
  })
})

// Request shapes recorded from the addons (docs/design/torrents.md §8 and the
// spike on PR #674): MediaFusion calls /v0/store/torz with the store header pair
// and checks in batches of 80 with `sid`; Comet calls the older /v0/store/magnets
// paths with `client_ip`, posts `magnet`, and generates links on the store root.
describe('StremThru addon compatibility', () => {
  it('answers MediaFusion: validate, check in batches of 80, add, then generate a link', async () => {
    const { call } = await setup()
    const batch = [CACHED_HASH, ...Array.from({ length: 79 }, (_, i) => i.toString(16).padStart(40, '0'))]

    const user = await json<{ data: { subscription_status: string } }>(await call('/v0/store/user'))
    const check = await json<{ data: { items: Array<{ hash: string; status: string }> } }>(
      await call(`/v0/store/torz/check?hash=${batch.join(',')}&sid=1254207`),
    )
    const added = await json<{ data: Torz }>(
      await call('/v0/store/torz', {
        method: 'POST',
        body: JSON.stringify({
          link: `magnet:?xt=urn:btih:${CACHED_HASH}&tr=${encodeURIComponent('udp://tracker.example:1337/announce')}`,
        }),
      }),
    )
    const video = added.data.files.find((file) => file.name.endsWith('.mkv'))
    const generated = await json<{ data: { link: string } }>(
      await call('/v0/store/torz/link/generate', { method: 'POST', body: JSON.stringify({ link: video?.link }) }),
    )

    expect(user.data.subscription_status).toBe('premium')
    expect(check.data.items).toHaveLength(80)
    expect(check.data.items.filter((item) => item.status === 'cached').map((item) => item.hash)).toEqual([CACHED_HASH])
    expect(added.data.status).toBe('downloaded')
    expect(download(generated.data.link)).toEqual(VIDEO)
  })

  it('answers Comet: check by magnet, add a magnet, list, and generate on the store root', async () => {
    const { call } = await setup()
    const clientIp = 'client_ip=203.0.113.7'

    const user = await json<{ data: { subscription_status: string } }>(await call(`/v0/store/user?${clientIp}`))
    const check = await json<{ data: { items: Array<{ hash: string; status: string; files: unknown[] }> } }>(
      await call(`/v0/store/magnets/check?magnet=${CACHED_HASH},${UNKNOWN_HASH}&${clientIp}&sid=tt0903747:1:1`),
    )
    const added = await json<{ data: Torz }>(
      await call(`/v0/store/magnets?${clientIp}`, {
        method: 'POST',
        body: JSON.stringify({ magnet: `magnet:?xt=urn:btih:${CACHED_HASH}&dn=${encodeURIComponent('Show S01')}` }),
      }),
    )
    const listed = await json<{ data: { items: Torz[]; total_items: number } }>(
      await call(`/v0/store/magnets?limit=500&offset=0&${clientIp}`),
    )
    const generated = await json<{ data: { link: string } }>(
      await call(`/v0/store/link/generate?${clientIp}`, {
        method: 'POST',
        body: JSON.stringify({ link: added.data.files[0].link }),
      }),
    )
    const removed = await call(`/v0/store/magnets/${added.data.id}?${clientIp}`, { method: 'DELETE' })

    expect(user.data.subscription_status).toBe('premium')
    expect(check.data.items.map((item) => item.status)).toEqual(['cached', 'unknown'])
    expect(check.data.items[0].files).toHaveLength(2)
    expect(added.data.status).toBe('downloaded')
    expect(listed.data).toMatchObject({ total_items: 1, items: [{ id: added.data.id, status: 'downloaded' }] })
    expect(download(generated.data.link)).toEqual(VIDEO)
    expect(removed.status).toBe(200)
  })

  it('rejects requests without a link and unknown paths in the StremThru envelope', async () => {
    const { call } = await setup()

    const noLink = await call('/v0/store/torz', { method: 'POST', body: JSON.stringify({}) })
    const badLimit = await call('/v0/store/torz?limit=0')
    const unknown = await call('/v0/store/newz')

    expect(noLink.status).toBe(400)
    expect(await json(noLink)).toEqual({
      error: { code: 'BAD_REQUEST', message: 'A magnet link or torrent URL is required' },
    })
    expect(badLimit.status).toBe(400)
    expect(unknown.status).toBe(404)
    expect(await json(unknown)).toEqual({ error: { code: 'NOT_FOUND', message: 'Not Found' } })
  })
})
