import { env } from 'cloudflare:workers'
import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import { sql } from 'drizzle-orm'
import { generateKeys, sign } from 'paseto-ts/v4'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLicenseBindingRepo } from '../server/adapters/repos/license-binding'
import { createMatterRepo } from '../server/adapters/repos/matter'
import { createMediaLibraryRepo } from '../server/adapters/repos/media-library'
import { createDeps } from '../server/composition'
import { getTrustedLicenseKeys } from '../server/domain/license-keys'
import { createCloudflarePlatform } from '../server/platform/cloudflare'
import { trustTestLicenseKey, untrustTestLicenseKey } from '../server/test/license-keys'
import { sweepMediaLibraries } from '../server/usecases/media-library-scan'
import type { BackgroundJobMessage } from '../server/usecases/ports'
import { generateId } from '../shared/ids'

const { secretKey, publicKey } = generateKeys('public')
// A key supplied through the environment must never become trusted; the test key is
// trusted only through the test-only hook.
const licensedEnv = { ...env, ZPAN_LICENSE_PUBLIC_KEYS: generateKeys('public').publicKey }
const db = createCloudflarePlatform(licensedEnv).db

beforeAll(async () => {
  trustTestLicenseKey(publicKey)
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + 3600
  await createLicenseBindingRepo(db).createLicenseBinding({
    cloudBindingId: 'sweep-binding',
    instanceId: 'sweep-instance',
    cloudAccountId: 'sweep-account',
    refreshToken: 'sweep-refresh-token',
    cachedCert: sign(secretKey, {
      type: 'zpan.license',
      issuer: ZPAN_CLOUD_URL_DEFAULT,
      subject: 'sweep-binding',
      accountId: 'sweep-account',
      instanceId: 'sweep-instance',
      storeId: 'sweep-store',
      edition: 'pro',
      licenseId: 'sweep-license',
      authorizedHosts: ['localhost'],
      licenseValidUntil: issuedAt + 365 * 24 * 60 * 60,
      issuedAt,
      notBefore: issuedAt,
      expiresAt,
    }),
    cachedExpiresAt: expiresAt,
    lastRefreshAt: issuedAt,
  })
})

afterAll(async () => {
  untrustTestLicenseKey(publicKey)
  await db.run(sql`DELETE FROM license_bindings WHERE cloud_binding_id = 'sweep-binding'`)
})

// Counts what a Workers invocation pays for: every D1 round trip (a standalone
// statement or one batch) and every statement prepared.
function countingD1(inner: D1Database) {
  const counts = { roundTrips: 0, statements: 0 }
  const unwrapped = new WeakMap<object, D1PreparedStatement>()
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const run = statement as unknown as Record<'first' | 'all' | 'run' | 'raw', (...args: unknown[]) => unknown>
    const execute =
      (method: 'first' | 'all' | 'run' | 'raw') =>
      (...args: unknown[]) => {
        counts.roundTrips++
        return run[method](...args)
      }
    const wrapper = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      first: execute('first'),
      all: execute('all'),
      run: execute('run'),
      raw: execute('raw'),
    }
    unwrapped.set(wrapper, statement)
    return wrapper as unknown as D1PreparedStatement
  }
  const counted = {
    prepare(query: string) {
      counts.statements++
      return wrap(inner.prepare(query))
    },
    batch(statements: D1PreparedStatement[]) {
      counts.roundTrips++
      return inner.batch(statements.map((statement) => unwrapped.get(statement) ?? statement))
    },
  }
  return { d1: counted as unknown as D1Database, counts }
}

async function sweepCounted() {
  const { d1, counts } = countingD1(env.DB)
  const queueBatches: BackgroundJobMessage[][] = []
  const queue = {
    async send(message: BackgroundJobMessage) {
      queueBatches.push([message])
    },
    async sendBatch(messages: Iterable<{ body: BackgroundJobMessage }>) {
      queueBatches.push([...messages].map((message) => message.body))
    },
  }
  const deps = createDeps(createCloudflarePlatform({ ...licensedEnv, DB: d1, ARCHIVE_QUEUE: queue }))
  await sweepMediaLibraries(deps, { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT })
  return { ...counts, queueBatchSizes: queueBatches.map((batch) => batch.length), messages: queueBatches.flat() }
}

async function seedOrg() {
  const orgId = generateId()
  await db.run(sql`INSERT INTO organization (id, name, slug, metadata) VALUES (${orgId}, 'Sweep', ${orgId}, '{}')`)
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
      storageId: 'sweep-storage',
      status: 'active',
    })
  // A folder at `path` (its parent folders must exist) with a video, marked as
  // a library, with or without its library.json.
  const addLibrary = async (path: string, options: { indexed: boolean }) => {
    const slash = path.lastIndexOf('/')
    const folder = await add(path.slice(0, Math.max(slash, 0)), path.slice(slash + 1), DirType.USER_FOLDER)
    await add(path, 'Dune (2021).mkv', DirType.FILE)
    if (options.indexed) await add(path, 'library.json', DirType.FILE, 'application/feed+json')
    const library = await createMediaLibraryRepo(db).create({
      orgId,
      folderId: folder.id,
      createdByUserId: generateId(),
      createdBy: { type: 'user', ref: null, issuer: null },
    })
    if (!library) throw new Error('library not created')
    return library
  }
  return { orgId, add, addLibrary }
}

async function clearLibraries() {
  await db.run(sql`DELETE FROM media_libraries`)
  await db.run(sql`DELETE FROM background_jobs`)
}

describe('license key trust on Workers', () => {
  it('ignores ZPAN_LICENSE_PUBLIC_KEYS from the Worker environment', () => {
    const trusted = getTrustedLicenseKeys().map((key) => key.publicKey)
    expect(trusted).not.toContain(licensedEnv.ZPAN_LICENSE_PUBLIC_KEYS)
  })
})

describe('[CF] media library sweep on D1', () => {
  it('reads each library with the same subtree fingerprint as fingerprint() [spec: media-library/sweep-batched]', async () => {
    await clearLibraries()
    const { orgId, add, addLibrary } = await seedOrg()
    const path = 'Media/[TGx]_100%'
    await add('', 'Media', DirType.USER_FOLDER)
    const library = await addLibrary(path, { indexed: true })
    await add(`${path}/Show/Season 1`, 'S01E01.mkv', DirType.FILE)
    for (const outside of [`${path}-sibling`, `${path}0`, 'Media/[TGx]X100%']) {
      await add(outside, 'Outside.2020.mkv', DirType.FILE)
    }
    const repo = createMediaLibraryRepo(db)

    const [state] = await repo.listForSweep()

    expect(state).toMatchObject({ id: library.id, indexed: true, folder: { path, trashed: false } })
    expect(state.subtreeFingerprint).toBe(await repo.fingerprint(orgId, path))
    // The two videos of 100 bytes: library.json is excluded, and the siblings
    // that share the prefix or match it as a LIKE pattern stay outside.
    expect(state.subtreeFingerprint).toMatch(/^2:200:/)
  })

  it('pays one read, one delete, and a job write and queue send per 100 libraries, for 1 or 150 [spec: media-library/sweep-batched]', async () => {
    await clearLibraries()
    const small = await seedOrg()
    await small.addLibrary(`Library ${generateId()}`, { indexed: true })

    const one = await sweepCounted()

    await clearLibraries()
    const large = await seedOrg()
    const changed = []
    for (let i = 0; i < 150; i++) changed.push(await large.addLibrary(`Changed ${i}`, { indexed: true }))
    for (let i = 0; i < 150; i++) await large.addLibrary(`Removed ${i}`, { indexed: false })

    const many = await sweepCounted()
    const again = await sweepCounted()

    // Round trips: license 1 + read 1 + (dead ? 1 : 0) + ceil(changed / 100) job writes;
    // queue calls: ceil(changed / 100).
    expect(one).toMatchObject({ roundTrips: 3, queueBatchSizes: [1] })
    expect(many).toMatchObject({ roundTrips: 5, queueBatchSizes: [100, 50] })
    expect(again).toMatchObject({ roundTrips: 2, queueBatchSizes: [] })
    expect(new Set(many.messages.map((message) => message.request.libraryId))).toEqual(
      new Set(changed.map((library) => library.id)),
    )
    const remaining = await db.all<{ id: string }>(sql`SELECT id FROM media_libraries`)
    expect(new Set(remaining.map((row) => row.id))).toEqual(new Set(changed.map((library) => library.id)))
  }, 120_000)
})
