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
    status: 'ready',
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
      input({ torrentId: null, infoHash: null, sourceUri: 'https://example.com/x.torrent', status: 'resolving' }),
    )

    const page = await deps.workspaceTorrents.listByOffset(orgId, { limit: 1, offset: 1 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(await deps.workspaceTorrents.countByTorrent(torrent.id)).toBe(1)
    expect(
      await deps.workspaceTorrents.findUnresolvedBySourceUri(orgId, 'https://example.com/x.torrent'),
    ).toMatchObject({ status: 'resolving' })
    const paged = await deps.workspaceTorrents.list(orgId, { pageSize: 1 })
    expect(paged.items).toHaveLength(1)
    expect(paged.nextBoundary).not.toBeNull()

    await deps.workspaceTorrents.delete(entry.id)
    expect(await deps.workspaceTorrents.countByTorrent(torrent.id)).toBe(0)
  })
})
