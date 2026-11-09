import { env } from 'cloudflare:workers'
import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../server/adapters/gateways/s3'
import { createBackgroundJobRepo } from '../server/adapters/repos/background-job'
import { createLicenseBindingRepo } from '../server/adapters/repos/license-binding'
import { createMatterRepo } from '../server/adapters/repos/matter'
import { createMediaLibraryRepo } from '../server/adapters/repos/media-library'
import { createSystemOptionsRepo } from '../server/adapters/repos/system-options'
import { orgQuotaEntitlements, orgQuotas } from '../server/db/schema'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { createFakeTmdb, FAKE_TMDB_TOKEN } from '../server/test/fake-tmdb'
import type { BackgroundJobMessage } from '../server/usecases/ports'
import { generateId } from '../shared/ids'
import worker from './bootstrap'

const QUOTA_BYTES = 10_000_000
const { secretKey, publicKey } = generateKeys('public')
const sent: BackgroundJobMessage[] = []
const testEnv = {
  ...env,
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars',
  ZPAN_LICENSE_PUBLIC_KEYS: publicKey,
  ARCHIVE_QUEUE: {
    async send(message: BackgroundJobMessage) {
      sent.push(message)
    },
    async sendBatch(messages: Iterable<{ body: BackgroundJobMessage }>) {
      for (const message of messages) sent.push(message.body)
    },
  },
}
const db = createCloudflarePlatform(testEnv).db

afterEach(() => {
  vi.restoreAllMocks()
})

async function seedLicense() {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'scrape-binding',
    instanceId: 'scrape-instance',
    cloudAccountId: 'scrape-account',
    refreshToken: 'scrape-refresh-token',
    cachedCert: sign(secretKey, {
      type: 'zpan.license',
      issuer: ZPAN_CLOUD_URL_DEFAULT,
      subject: 'scrape-binding',
      accountId: 'scrape-account',
      instanceId: 'scrape-instance',
      storeId: 'scrape-store',
      edition: 'pro',
      licenseId: 'scrape-license',
      authorizedHosts: ['localhost'],
      licenseValidUntil: issuedAt + 365 * 24 * 60 * 60,
      issuedAt,
      notBefore: issuedAt,
      expiresAt,
    }),
    cachedExpiresAt: expiresAt,
    lastRefreshAt: issuedAt,
  })
}

async function seedWorkspace() {
  const orgId = generateId()
  const userId = generateId()
  const storageId = generateId()
  const now = Date.now()
  await db.run(sql`INSERT INTO organization (id, name, slug, metadata) VALUES (${orgId}, 'CF Scrape', ${orgId}, '{}')`)
  await db.insert(orgQuotas).values({ id: generateId(), orgId, quota: QUOTA_BYTES })
  await db.insert(orgQuotaEntitlements).values({
    id: generateId(),
    orgId,
    resourceType: 'storage',
    entitlementType: 'plan',
    source: 'free_plan',
    sourceId: `free_plan:${orgId}`,
    bytes: QUOTA_BYTES,
    startsAt: new Date(),
    expiresAt: null,
    status: 'active',
    metadata: JSON.stringify({ packageName: 'Free', source: 'free_plan' }),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${storageId}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
  `)
  const matters = createMatterRepo(db)
  const add = (parent: string, name: string, dirtype: number, type = 'application/octet-stream') =>
    matters.create({
      orgId,
      name,
      type: dirtype === DirType.FILE ? type : 'folder',
      size: dirtype === DirType.FILE ? 100 : 0,
      dirtype,
      parent,
      object: dirtype === DirType.FILE ? `objects/${generateId()}` : '',
      storageId,
      status: 'active',
    })
  return { orgId, userId, matters, add }
}

describe('[CF] media library scrapes on the Workers queue', () => {
  it('continues a scrape in a second queue message and queues the scan that publishes it [spec: media-scraping/queue-consumer]', async () => {
    await seedLicense()
    await createSystemOptionsRepo(db).setMany([{ key: 'media_scraper_tmdb_access_token', value: FAKE_TMDB_TOKEN }])
    const movies = Array.from({ length: 21 }, (_, i) => ({
      id: 2000 + i,
      title: `Film ${String(i).padStart(2, '0')}`,
      releaseDate: '2001-01-01',
      posterPath: `/poster-${i}.jpg`,
    }))
    const tmdb = createFakeTmdb({ movies })
    vi.spyOn(globalThis, 'fetch').mockImplementation(tmdb.fetch)
    const objects = new Map<string, Uint8Array>()
    vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
      objects.set(key, bytes)
      return bytes.byteLength
    })
    vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
      objects.delete(key)
    })

    const { orgId, userId, matters, add } = await seedWorkspace()
    const folder = await add('', 'Movies', DirType.USER_FOLDER)
    for (const movie of movies) await add('Movies', `${movie.title} (2001).mkv`, DirType.FILE)
    await add('Movies', 'library.json', DirType.FILE, 'application/feed+json')
    const library = await createMediaLibraryRepo(db).create({
      orgId,
      folderId: folder.id,
      createdByUserId: userId,
      createdBy: { type: 'user', ref: userId, issuer: null },
    })
    if (!library) throw new Error('library not created')
    const request = { type: 'media_library_scrape' as const, libraryId: library.id }
    const job = await createBackgroundJobRepo(db).create({ orgId, userId, type: request.type, metadata: request })
    const deliver = async (body: BackgroundJobMessage) => {
      const ack = vi.fn()
      await worker.queue({ messages: [{ body, ack }] } as unknown as MessageBatch<BackgroundJobMessage>, testEnv)
      expect(ack).toHaveBeenCalledOnce()
    }

    await deliver({ jobId: job.id, orgId, userId, createdBy: { type: 'system', ref: null, issuer: null }, request })

    expect(sent).toHaveLength(1)
    const [continuation] = sent.splice(0)
    expect(continuation).toMatchObject({
      jobId: job.id,
      request: { resume: { after: { parent: 'Movies', name: 'Film 19 (2001).mkv' }, processed: 20 } },
    })
    await expect(createBackgroundJobRepo(db).get(orgId, job.id)).resolves.toMatchObject({
      status: 'running',
      progress: { fileCount: 20 },
    })

    await deliver(continuation)

    await expect(createBackgroundJobRepo(db).get(orgId, job.id)).resolves.toMatchObject({
      status: 'completed',
      progress: { fileCount: 21 },
      resultMetadata: { matched: 21, unmatched: 0 },
    })
    const rows = await db.all<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM media_scrapes WHERE org_id = ${orgId}`,
    )
    expect(rows).toEqual([{ count: 21 }])
    expect(await matters.findActiveConflict(orgId, 'Movies', 'Film 20 (2001)-poster.jpg')).toMatchObject({
      createdByActorType: 'system',
    })

    expect(sent.map((message) => message.request.type)).toEqual(['media_library_scan'])
    await deliver(sent.splice(0)[0])
    expect(sent).toEqual([])
  })
})
