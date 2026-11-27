import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../../adapters/gateways/s3.js'
import { torrentFileMime } from '../../domain/torrent-info.js'
import { authedHeaders, createTestApp } from '../../test/setup.js'
import { buildTorrent, fileBytes, type TorrentFixture } from '../../test/torrent-fixture.js'
import { serveTaskFromCache } from './fill.js'
import { transferTorrent } from './instant-transfer.js'
import { processTorrentVerify, verifyPieceRange } from './verify.js'

// Four 16 KiB pieces per message, so full verification continues over messages.
vi.mock('../../domain/torrent-cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/torrent-cache')>()),
  TORRENT_VERIFY_BATCH_BYTES: 64 * 1024,
}))

type TestApp = Awaited<ReturnType<typeof createTestApp>>

let objects: Map<string, Uint8Array>
let ranges: string[]

beforeEach(() => {
  vi.restoreAllMocks()
  objects = new Map()
  ranges = []
  vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_s, key) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error('NoSuchKey')
    return bytes
  })
  vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(async (_s, key, range) => {
    const bytes = objects.get(key)
    if (!bytes) throw new Error('NoSuchKey')
    ranges.push(`${key} ${range}`)
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '') ?? []
    return new Response(bytes.slice(Number(from), Number(to) + 1)).body as ReadableStream<Uint8Array>
  })
})

async function seedStorage(db: TestApp['db'], id: string, endpoint: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'bucket', ${endpoint}, 'auto', 'key', 'secret', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function personalWorkspace(db: TestApp['db'], email: string) {
  const [row] = await db.all<{ orgId: string; userId: string }>(sql`
    SELECT o.id AS orgId, u.id AS userId FROM organization o
    JOIN member m ON m.organization_id = o.id JOIN user u ON u.id = m.user_id
    WHERE u.email = ${email} AND o.metadata LIKE '%"type":"personal"%'
  `)
  return row
}

// A torrent whose files were uploaded into the cache, waiting for verification.
async function uploadedTorrent(deps: TestApp['deps'], storageId: string, torrent: TorrentFixture) {
  objects.set(`bt/${torrent.infoHash}/info`, torrent.info)
  for (const file of torrent.files.filter((item) => !item.padding)) {
    objects.set(`bt/${torrent.infoHash}/${file.fileIdx}`, file.bytes)
  }
  return deps.torrents.create({
    infoHash: torrent.infoHash,
    storageId,
    name: torrent.name,
    private: false,
    status: 'verifying',
    files: torrent.files
      .filter((file) => !file.padding)
      .map((file) => ({
        fileIdx: file.fileIdx,
        path: file.path,
        size: file.bytes.length,
        mime: torrentFileMime(file.path),
      })),
  })
}

async function runVerify(deps: TestApp['deps'], owner: { orgId: string; userId: string }, torrentId: string) {
  const request = { type: 'torrent_verify' as const, torrentId }
  const job = await deps.backgroundJobs.create({
    orgId: owner.orgId,
    userId: owner.userId,
    type: 'torrent_verify',
    metadata: request,
  })
  await processTorrentVerify(deps, {
    jobId: job.id,
    orgId: owner.orgId,
    userId: owner.userId,
    createdBy: { type: 'user', ref: owner.userId, issuer: null },
    request,
  })
  return job.id
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read()
    if (done(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}

function torrentWithPieces(name: string) {
  // 12 pieces across two files and a padding file, so pieces span files.
  return buildTorrent(name, [
    { path: 'a.mkv', bytes: fileBytes(70_000, 7) },
    { path: '.pad/11920', bytes: new Uint8Array(11_920), padding: true },
    { path: 'b.mkv', bytes: fileBytes(114_688, 8) },
  ])
}

describe('torrent_verify', () => {
  it('shares a torrent only after its pieces verify [spec: torrent-cache/verify-pieces]', async () => {
    const { app, db, deps } = await createTestApp()
    await authedHeaders(app, 'verify-owner@example.com')
    await authedHeaders(app, 'verify-other@example.com')
    const owner = await personalWorkspace(db, 'verify-owner@example.com')
    const other = await personalWorkspace(db, 'verify-other@example.com')
    await seedStorage(db, 'r2-storage', 'https://acct.r2.cloudflarestorage.com')

    // Correct bytes on R2: every piece is read, over several messages.
    const good = torrentWithPieces('Good')
    const goodRow = await uploadedTorrent(deps, 'r2-storage', good)
    await runVerify(deps, owner, goodRow.id)
    const verifiedGood = await waitFor(
      () => deps.torrents.get(goodRow.id),
      (row) => row?.status !== 'verifying',
    )
    expect(verifiedGood).toMatchObject({ status: 'ready', verified: 'full' })

    // One altered byte in the last piece of b.mkv.
    const bad = torrentWithPieces('Bad')
    const badRow = await uploadedTorrent(deps, 'r2-storage', bad)
    const altered = new Uint8Array(bad.files[2].bytes)
    altered[altered.length - 1] ^= 0xff
    objects.set(`bt/${bad.infoHash}/2`, altered)
    // A task from another workspace waits for it.
    const now = new Date()
    await deps.downloadTasks.insert({
      id: 'joined-task',
      orgId: other.orgId,
      createdByUserId: other.userId,
      sourceType: 'magnet',
      sourceUri: bad.magnet,
      displayName: null,
      targetFolder: '',
      category: null,
      tags: [],
      assignedDownloaderId: null,
      status: 'queued',
      assignedAt: null,
      infoHash: bad.infoHash,
      now,
    })
    expect(await serveTaskFromCache(deps, await deps.downloadTasks.getRecord(other.orgId, 'joined-task'))).toBe(
      'joined',
    )

    const jobId = await runVerify(deps, owner, badRow.id)
    const verifiedBad = await waitFor(
      () => deps.torrents.get(badRow.id),
      (row) => row?.status !== 'verifying',
    )
    expect(verifiedBad).toMatchObject({ status: 'invalid', verified: null })
    const job = await waitFor(
      () => deps.backgroundJobs.get(owner.orgId, jobId),
      (row) => row.status !== 'running' && row.status !== 'queued',
    )
    expect(job).toMatchObject({ status: 'failed', errorMessage: 'Piece 11 does not match the torrent' })

    // Never handed to another workspace: the waiting task fails, a new submit
    // finds nothing to serve, and a transfer is refused.
    expect(await deps.downloadTasks.getRecord(other.orgId, 'joined-task')).toMatchObject({
      status: 'failed',
      errorMessage: 'The cached download failed verification',
    })
    const transfer = await transferTorrent(deps, {
      torrentId: badRow.id,
      orgId: other.orgId,
      userId: other.userId,
      targetFolder: '',
    })
    expect(transfer.ok).toBe(false)
    const [held] = await db.all<{ count: number }>(sql`
      SELECT COUNT(*) AS count FROM matters WHERE org_id = ${other.orgId} AND object LIKE 'bt/%'
    `)
    expect(held.count).toBe(0)
  })

  it('verifies a sample of 32 pieces on storages that charge egress', async () => {
    const { app, db, deps } = await createTestApp()
    await authedHeaders(app, 'sample-owner@example.com')
    const owner = await personalWorkspace(db, 'sample-owner@example.com')
    await seedStorage(db, 's3-storage', 'https://s3.us-east-1.amazonaws.com')
    // 100 pieces of 1 KiB.
    const torrent = buildTorrent('Sampled', [{ path: 'Sampled', bytes: fileBytes(100 * 1024, 3) }], 1024)
    const row = await uploadedTorrent(deps, 's3-storage', torrent)

    await runVerify(deps, owner, row.id)

    expect(await deps.torrents.get(row.id)).toMatchObject({ status: 'ready', verified: 'sampled' })
    expect(ranges).toHaveLength(32)
  })

  it('skips a torrent that is no longer verifying and fails a job whose storage is gone', async () => {
    const { app, db, deps } = await createTestApp()
    await authedHeaders(app, 'skip-owner@example.com')
    const owner = await personalWorkspace(db, 'skip-owner@example.com')
    await seedStorage(db, 'gone-storage', 'https://s3.example.com')
    const torrent = buildTorrent('Skip', [{ path: 'Skip', bytes: fileBytes(1000, 1) }])
    const row = await uploadedTorrent(deps, 'gone-storage', torrent)
    await deps.torrents.transition(row.id, ['verifying'], 'ready', { verified: 'full' })
    const skipped = await runVerify(deps, owner, row.id)
    expect(await deps.backgroundJobs.get(owner.orgId, skipped)).toMatchObject({
      status: 'completed',
      resultMetadata: { skipped: true, status: 'ready' },
    })

    await deps.torrents.transition(row.id, ['ready'], 'verifying')
    objects.delete(`bt/${torrent.infoHash}/info`)
    const failed = await runVerify(deps, owner, row.id)
    expect(await deps.backgroundJobs.get(owner.orgId, failed)).toMatchObject({ status: 'failed', retryable: true })
    expect(await deps.torrents.get(row.id)).toMatchObject({ status: 'verifying' })
  })

  it('reports the first piece a missing or short object cannot hold', async () => {
    const { deps } = await createTestApp()
    const torrent = buildTorrent('Short', [
      { path: 'a', bytes: fileBytes(20_000, 1) },
      { path: 'b', bytes: fileBytes(20_000, 2) },
    ])
    const { parseTorrentInfo } = await import('../../domain/torrent-info.js')
    const info = parseTorrentInfo(torrent.info)
    const storage = {
      bucket: 'b',
      endpoint: 'https://s3.example.com',
      region: 'auto',
      accessKey: 'k',
      secretKey: 's',
      forcePathStyle: false,
    }
    objects.set(`bt/${torrent.infoHash}/0`, torrent.files[0].bytes)
    // b is missing: piece 1 spans a and b.
    expect(await verifyPieceRange(deps, storage, torrent.infoHash, info, 0, info.pieceCount)).toBe(1)
    // b is short.
    objects.set(`bt/${torrent.infoHash}/1`, torrent.files[1].bytes.slice(0, 5000))
    expect(await verifyPieceRange(deps, storage, torrent.infoHash, info, 0, info.pieceCount)).toBe(1)
    objects.set(`bt/${torrent.infoHash}/1`, torrent.files[1].bytes)
    expect(await verifyPieceRange(deps, storage, torrent.infoHash, info, 0, info.pieceCount)).toBeNull()
  })

  it('returns the first insert of an infoHash to a concurrent second one', async () => {
    const { db, deps } = await createTestApp()
    await seedStorage(db, 'race-storage', 'https://s3.example.com')
    const input = {
      infoHash: 'ab'.repeat(20),
      storageId: 'race-storage',
      name: 'Race',
      private: false,
      status: 'downloading' as const,
      files: [{ fileIdx: 0, path: 'Race', size: 1, mime: '' }],
    }
    const results = await Promise.all([deps.torrents.createIfAbsent(input), deps.torrents.createIfAbsent(input)])
    expect(results.map((result) => result.created).sort()).toEqual([false, true])
    expect(results[0].torrent.id).toBe(results[1].torrent.id)
  })
})
