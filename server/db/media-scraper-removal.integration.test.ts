import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import { mediaLibraryFeedSchema } from '@shared/schemas'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3'
import { createBackgroundJobRepo } from '../adapters/repos/background-job'
import { createMatterRepo } from '../adapters/repos/matter'
import { createMediaLibraryRepo } from '../adapters/repos/media-library'
import { createDeps } from '../composition'
import { serializeMediaLibraryFeed } from '../domain/media-library'
import type { Platform } from '../platform/interface'
import { seedProLicense } from '../test/setup'
import { createMediaLibraryIndex } from '../usecases/media-library-index'
import { sweepMediaLibraries } from '../usecases/media-library-scan'
import * as authSchema from './auth-schema'
import * as schema from './schema'

const MIGRATIONS = join(process.cwd(), 'migrations')
// The last migration before server-side scraping was removed.
const BEFORE_REMOVAL = '0101_torrent-cache'

type JournalEntry = { idx: number; tag: string }

function journal(): JournalEntry[] {
  return (JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as { entries: JournalEntry[] })
    .entries
}

function apply(sqlite: Database.Database, entries: JournalEntry[]) {
  for (const { tag } of entries) {
    const text = readFileSync(join(MIGRATIONS, `${tag}.sql`), 'utf8')
    for (const statement of text.split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.exec(statement)
    }
  }
}

const objects = new Map<string, Uint8Array>()

afterEach(() => {
  vi.restoreAllMocks()
  objects.clear()
})

function stubStorage() {
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    objects.set(key, bytes)
    return bytes.byteLength
  })
  vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
    objects.delete(key)
  })
}

describe('removing server-side scraping from a production database', () => {
  it('drops media_scrapes, the scraper options, and scrape jobs, and scans still publish the index [spec: media-library/scrapes-table-dropped]', async () => {
    const entries = journal()
    const cut = entries.findIndex((entry) => entry.tag === BEFORE_REMOVAL) + 1
    expect(cut).toBeGreaterThan(0)
    const sqlite = new Database(':memory:')
    apply(sqlite, entries.slice(0, cut))

    const now = Date.now()
    sqlite.exec(`
      INSERT INTO organization (id, name, slug, created_at) VALUES ('org-1', 'Org', 'org-1', ${now});
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('storage-1', 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now});
      INSERT INTO system_options (key, value) VALUES
        ('media_scraper_tmdb_access_token', 'tmdb-token'),
        ('media_scraper_language', 'zh-CN'),
        ('site_name', 'Kept');
    `)
    const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })
    const platform: Platform = {
      db,
      getEnv: (key) => (key === 'BETTER_AUTH_SECRET' ? 'test-secret' : undefined),
      getBinding: () => undefined,
    }
    const deps = createDeps(platform)
    const matters = createMatterRepo(db)
    const add = (parent: string, name: string, kind: 'file' | 'folder' = 'file') =>
      matters.create({
        orgId: 'org-1',
        name,
        type: kind === 'file' ? 'video/mp4' : 'folder',
        size: kind === 'file' ? 100 : 0,
        dirtype: kind === 'file' ? DirType.FILE : DirType.USER_FOLDER,
        parent,
        object: kind === 'file' ? `objects/${name}` : '',
        storageId: 'storage-1',
        status: 'active',
      })
    const folder = await add('', 'Movies', 'folder')
    const video = await add('Movies', 'Sintel (2010).mp4')
    const createdBy = { type: 'user' as const, ref: 'user-1', issuer: null }
    const library = await createMediaLibraryRepo(db).create({
      orgId: 'org-1',
      folderId: folder.id,
      createdByUserId: 'user-1',
      createdBy,
    })
    if (!library) throw new Error('library not created')
    sqlite.exec(`
      INSERT INTO media_scrapes (matter_id, org_id, library_id, status, tmdb_type, tmdb_id, language, source, match_key, file_updated_at, scraped_at)
      VALUES ('${video.id}', 'org-1', '${library.id}', 'matched', 'movie', 45745, 'zh-CN', 'search', 'sintel:2010', ${now}, ${now});
      INSERT INTO background_jobs (id, org_id, user_id, type, status, target_folder, metadata, cancelable, created_at, updated_at)
      VALUES ('scrape-job', 'org-1', 'user-1', 'media_library_scrape', 'completed', 'Movies', '{"type":"media_library_scrape","libraryId":"${library.id}"}', 0, ${now}, ${now});
    `)

    apply(sqlite, entries.slice(cut))

    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE name = 'media_scrapes'`).all()).toEqual([])
    expect(sqlite.prepare('SELECT key FROM system_options ORDER BY key').all()).toEqual([{ key: 'site_name' }])
    expect(sqlite.prepare('SELECT id FROM background_jobs').all()).toEqual([])

    stubStorage()
    await seedProLicense(db)
    await db.insert(schema.orgQuotas).values({ id: 'quota-1', orgId: 'org-1', quota: 0, used: 0 })
    await db.insert(schema.orgQuotaEntitlements).values({
      id: 'entitlement-1',
      orgId: 'org-1',
      resourceType: 'storage',
      entitlementType: 'plan',
      source: 'test',
      sourceId: 'test-storage-plan:org-1',
      bytes: 10_000_000,
      startsAt: new Date(),
      expiresAt: null,
      status: 'active',
      metadata: '{}',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await createMediaLibraryIndex(
      deps,
      { orgId: 'org-1', userId: 'user-1', createdBy },
      'Movies',
      serializeMediaLibraryFeed(
        { libraryId: library.id, folderPath: 'Movies', folderName: 'Movies', generatedAt: new Date() },
        [],
      ),
    )
    await matters.setMediaMetadata(
      'org-1',
      video.id,
      { kind: 'movie', tmdb: { id: 45745, type: 'movie' }, title: 'Sintel' },
      { onlyIfAbsent: false },
    )
    await sweepMediaLibraries(deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })

    const jobs = createBackgroundJobRepo(db)
    let scan = (await jobs.list('org-1', { type: 'media_library_scan', pageSize: 10 })).items[0]
    for (let i = 0; i < 50 && scan && scan.status !== 'completed' && scan.status !== 'failed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      scan = await jobs.get('org-1', scan.id)
    }
    expect(scan).toMatchObject({ status: 'completed' })
    const index = await matters.findActiveConflict('org-1', 'Movies', 'library.json')
    const feed = mediaLibraryFeedSchema.parse(
      JSON.parse(new TextDecoder().decode(objects.get(index?.object ?? '') ?? new Uint8Array())),
    )
    expect(feed.items.map((item) => item._media)).toEqual([
      { type: 'movie', title: 'Sintel', year: 2010, tmdb: { id: 45745, type: 'movie' } },
    ])
    sqlite.close()
  })
})
