import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../server/adapters/gateways/s3'
import { createBackgroundJobRepo } from '../server/adapters/repos/background-job'
import { createTorrentRepo } from '../server/adapters/repos/torrent-cache'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { buildTorrent, fileBytes } from '../server/test/torrent-fixture'
import type { BackgroundJobMessage } from '../server/usecases/ports'
import { generateId } from '../shared/ids'
import worker from './bootstrap'

const testEnv = { ...env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars' }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('[CF] torrent_verify on the Workers queue', () => {
  it('verifies every piece of an R2 torrent through crypto.DigestStream', async () => {
    // SAFETY: DigestStream is Workers-only and absent from the standard Crypto type.
    expect(typeof (crypto as unknown as { DigestStream?: unknown }).DigestStream).toBe('function')
    const db = createCloudflarePlatform(env).db
    const orgId = generateId()
    const userId = generateId()
    const storageId = generateId()
    const now = Date.now()
    await db.run(
      sql`INSERT INTO organization (id, name, slug, metadata) VALUES (${orgId}, 'CF Torrents', ${orgId}, '{}')`,
    )
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${storageId}, 'bucket', 'https://acct.r2.cloudflarestorage.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
    `)
    const fixture = buildTorrent('CF Show', [
      { path: 'E01.mkv', bytes: fileBytes(50_000, 11) },
      { path: 'E02.mkv', bytes: fileBytes(40_000, 12) },
    ])
    const objects = new Map<string, Uint8Array>([[`bt/${fixture.infoHash}/info`, fixture.info]])
    for (const file of fixture.files) objects.set(`bt/${fixture.infoHash}/${file.fileIdx}`, file.bytes)
    vi.spyOn(S3Service.prototype, 'getObjectBytes').mockImplementation(async (_s, key) => {
      const bytes = objects.get(key)
      if (!bytes) throw new Error('NoSuchKey')
      return bytes
    })
    vi.spyOn(S3Service.prototype, 'getObjectStream').mockImplementation(async (_s, key, range) => {
      const bytes = objects.get(key)
      if (!bytes) throw new Error('NoSuchKey')
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '') ?? []
      return new Response(bytes.slice(Number(from), Number(to) + 1)).body as ReadableStream<Uint8Array>
    })

    const torrents = createTorrentRepo(db)
    const torrent = await torrents.create({
      infoHash: fixture.infoHash,
      storageId,
      name: fixture.name,
      private: false,
      status: 'verifying',
      files: fixture.files.map((file) => ({
        fileIdx: file.fileIdx,
        path: file.path,
        size: file.bytes.length,
        mime: '',
      })),
    })
    const request = { type: 'torrent_verify' as const, torrentId: torrent.id }
    const job = await createBackgroundJobRepo(db).create({ orgId, userId, type: request.type, metadata: request })
    const message: BackgroundJobMessage = {
      jobId: job.id,
      orgId,
      userId,
      createdBy: { type: 'system', ref: null, issuer: null },
      request,
    }
    const ack = vi.fn()

    // SAFETY: the consumer reads only messages[].body and ack, which the stub provides.
    await worker.queue({ messages: [{ body: message, ack }] } as unknown as MessageBatch<BackgroundJobMessage>, testEnv)

    expect(ack).toHaveBeenCalledOnce()
    expect(await torrents.get(torrent.id)).toMatchObject({ status: 'ready', verified: 'full' })
    expect(await createBackgroundJobRepo(db).get(orgId, job.id)).toMatchObject({
      status: 'completed',
      resultMetadata: { status: 'ready', verified: 'full', pieces: 6 },
    })
  })
})
