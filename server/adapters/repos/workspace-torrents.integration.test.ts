import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../../test/setup.js'
import type { NewWorkspaceTorrentInput } from '../../usecases/ports'

async function setup() {
  const ctx = await createTestApp()
  await authedHeaders(ctx.app)
  const now = Date.now()
  await ctx.db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('s1', 'bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
  const [org] = await ctx.db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  const torrent = await ctx.deps.torrents.create({
    infoHash: 'ab'.repeat(20),
    storageId: 's1',
    name: 'T',
    private: false,
    status: 'ready',
    files: [{ fileIdx: 0, path: 'a.mkv', size: 1, mime: 'video/x-matroska' }],
  })
  const input = (overrides: Partial<NewWorkspaceTorrentInput> = {}): NewWorkspaceTorrentInput => ({
    orgId: org.id,
    torrentId: torrent.id,
    infoHash: torrent.infoHash,
    source: 'stremthru',
    sourceUri: `magnet:?xt=urn:btih:${torrent.infoHash}`,
    displayName: null,
    taskId: null,
    status: 'active',
    createdBy: { type: 'api_key', ref: 'k', issuer: null },
    now: new Date(),
    ...overrides,
  })
  return { ...ctx, orgId: org.id, torrent, input }
}

describe('workspace torrents repo', () => {
  it('returns the entry that won a concurrent add of the same torrent', async () => {
    const { deps, input } = await setup()

    const [first, second] = await Promise.all([
      deps.workspaceTorrents.insert(input()),
      deps.workspaceTorrents.insert(input()),
    ])

    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(first.entry.id).toBe(second.entry.id)
    expect((await deps.workspaceTorrents.insert(input())).created).toBe(false)
  })

  it('pages by offset, counts holders and deletes entries', async () => {
    const { deps, orgId, torrent, input } = await setup()
    const { entry } = await deps.workspaceTorrents.insert(input())
    await deps.workspaceTorrents.insert(
      input({ torrentId: null, infoHash: null, sourceUri: 'https://example.com/x.torrent', status: 'active' }),
    )

    const page = await deps.workspaceTorrents.listByOffset(orgId, { limit: 1, offset: 1 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(await deps.workspaceTorrents.countByTorrent(torrent.id)).toBe(1)
    expect(await deps.workspaceTorrents.findBySourceUri(orgId, 'https://example.com/x.torrent')).toMatchObject({
      status: 'active',
    })
    const paged = await deps.workspaceTorrents.list(orgId, { pageSize: 1 })
    expect(paged.items).toHaveLength(1)
    expect(paged.nextBoundary).not.toBeNull()

    await deps.workspaceTorrents.delete(entry.id)
    expect(await deps.workspaceTorrents.countByTorrent(torrent.id)).toBe(0)
  })

  it('returns the entry that won a concurrent add of the same infoHash before the torrent is known', async () => {
    const { deps, orgId, input } = await setup()
    const hash = 'cd'.repeat(20)
    const waiting = (taskId: string) =>
      input({ torrentId: null, infoHash: hash, sourceUri: `magnet:?xt=urn:btih:${hash}`, status: 'active', taskId })

    const [first, second] = await Promise.all([
      deps.workspaceTorrents.insert(waiting('t1')),
      deps.workspaceTorrents.insert(waiting('t2')),
    ])

    expect([first.created, second.created].sort()).toEqual([false, true])
    expect(first.entry.id).toBe(second.entry.id)
    expect(await deps.workspaceTorrents.listWaiting(hash.toUpperCase())).toHaveLength(1)
    expect((await deps.workspaceTorrents.findByInfoHash(orgId, hash))?.id).toBe(first.entry.id)
  })

  it('finds a torrent URL entry by its link once it is resolved', async () => {
    const { deps, orgId, torrent, input } = await setup()
    const { entry } = await deps.workspaceTorrents.insert(input({ sourceUri: 'https://example.com/y.torrent' }))

    expect((await deps.workspaceTorrents.findBySourceUri(orgId, 'https://example.com/y.torrent'))?.id).toBe(entry.id)
    expect(entry.torrentId).toBe(torrent.id)
  })

  it('loses a capacity claim on a stremthru-held torrent accessed after it was ranked', async () => {
    const { deps, torrent, input } = await setup()
    await deps.workspaceTorrents.insert(input())
    const [candidate] = await deps.workspaceTorrents.listStremThruHeld(10)
    expect(candidate?.id).toBe(torrent.id)

    // A save to drive touches the torrent before its drive rows exist.
    await deps.torrents.touch(torrent.id, ['ready'], new Date(candidate.lastAccessedAt.getTime() + 1000))

    expect(await deps.workspaceTorrents.claimStremThruHeldForEviction(candidate)).toBe(false)
    expect((await deps.torrents.get(torrent.id))?.status).toBe('ready')
    expect(await deps.workspaceTorrents.countByTorrent(torrent.id)).toBe(1)
  })

  it('keeps a user’s playback links apart per workspace', async () => {
    const { db, deps, orgId, torrent } = await setup()
    await db.run(sql`INSERT INTO organization (id, name, slug) VALUES ('team-b', 'Team B', 'team-b')`)
    const [file] = await deps.torrents.listFiles(torrent.id)
    const expiresAt = new Date(Date.now() + 60_000)
    const now = new Date()

    await deps.stremthruLinks.save({ userId: 'u1', orgId, torrentFileId: file.id, url: 'https://a', expiresAt, now })

    expect(await deps.stremthruLinks.get('u1', 'team-b', file.id)).toBeNull()
    await deps.stremthruLinks.save({
      userId: 'u1',
      orgId: 'team-b',
      torrentFileId: file.id,
      url: 'https://b',
      expiresAt,
      now,
    })
    expect((await deps.stremthruLinks.get('u1', orgId, file.id))?.url).toBe('https://a')
    expect((await deps.stremthruLinks.get('u1', 'team-b', file.id))?.url).toBe('https://b')
    await deps.stremthruLinks.save({ userId: 'u1', orgId, torrentFileId: file.id, url: 'https://a2', expiresAt, now })
    expect((await deps.stremthruLinks.get('u1', orgId, file.id))?.url).toBe('https://a2')
  })

  it('loads several download tasks in one call and leaves out unknown ones', async () => {
    const { deps } = await setup()
    expect(await deps.downloadTasks.findRecords(['missing'])).toEqual([])
  })

  it('lists an abandoned fill and loses its claim once another download takes it over', async () => {
    const { deps } = await setup()
    const stopped = await deps.torrents.create({
      infoHash: 'ef'.repeat(20),
      storageId: 's1',
      name: 'Partial',
      private: false,
      status: 'downloading',
      files: [{ fileIdx: 0, path: 'b.mkv', size: 1, mime: 'video/x-matroska' }],
    })
    const before = new Date(Date.now() + 1000)
    const [candidate] = await deps.torrents.listAbandonedFills(before, 10)
    expect(candidate).toMatchObject({ id: stopped.id, sourceTaskId: null })

    expect(await deps.torrents.setSource(stopped.id, { taskId: 'takeover', downloaderId: 'd' }, new Date())).toBe(true)

    expect(await deps.torrents.claimAbandonedFill(candidate, before)).toBe(false)
    expect((await deps.torrents.get(stopped.id))?.status).toBe('downloading')
    const [taken] = await deps.torrents.listAbandonedFills(before, 10)
    expect(await deps.torrents.claimAbandonedFill(taken, before)).toBe(true)
    // A torrent no longer downloading cannot be taken over.
    expect(await deps.torrents.setSource(stopped.id, { taskId: 'late', downloaderId: 'd' }, new Date())).toBe(false)
  })
})
