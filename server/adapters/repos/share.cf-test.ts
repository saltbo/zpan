import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { DirType } from '../../../shared/constants'
import { generateId } from '../../../shared/ids'
import type { CreateShareInput } from '../../../shared/schemas/share'
import { matters } from '../../db/schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import type { Database } from '../../platform/interface'
import { createShareRepo } from './share'

const createShare = (db: Database, input: CreateShareInput) => createShareRepo(db).create(input)
const resolveShareByToken = (db: Database, token: string) => createShareRepo(db).resolveByToken(token)
const incrementDownloadsAtomic = (db: Database, shareId: string) =>
  createShareRepo(db).incrementDownloadsAtomic(shareId)
const revokeShareByToken = (db: Database, token: string, creatorId: string) =>
  createShareRepo(db).revokeByToken(token, creatorId)
const revokeByMatter = (db: Database, matterId: string) => createShareRepo(db).revokeByMatter(matterId)

function buildDb() {
  return createCloudflarePlatform(env).db
}

describe('[CF] shared folder paths on D1', () => {
  it.each([
    `Media/Movies/${'Long.Movie.Title.'.repeat(5)}[TGx]`,
    `媒体/电影/${'长目录'.repeat(20)}_100%`,
  ])('counts and resolves only literal descendants of %s', async (path) => {
    const db = buildDb()
    const repo = createShareRepo(db)
    const orgId = generateId()
    const now = new Date()
    const insert = async (overrides: Partial<typeof matters.$inferInsert>) => {
      const [row] = await db
        .insert(matters)
        .values({
          id: generateId(),
          orgId,
          alias: generateId(10),
          name: generateId(),
          type: 'application/octet-stream',
          size: 100,
          dirtype: DirType.FILE,
          parent: path,
          object: `objects/${generateId()}`,
          storageId: 'storage-1',
          status: 'active',
          createdAt: now,
          updatedAt: now,
          ...overrides,
        })
        .returning()
      return row
    }
    const root = await insert({
      parent: path.slice(0, path.lastIndexOf('/')),
      name: path.slice(path.lastIndexOf('/') + 1),
      dirtype: DirType.USER_FOLDER,
      size: 0,
    })
    const direct = await insert({ size: 10 })
    const nested = await insert({ parent: `${path}/sub/deep`, size: 20 })
    const excluded = [
      await insert({ parent: `${path}-sibling/sub` }),
      await insert({ parent: `${path.toLowerCase().replace('_', 'X').replace('%', 'anything')}/sub` }),
      await insert({ parent: `${path}/sub`, orgId: generateId() }),
      await insert({ parent: `${path}/sub`, status: 'pending' }),
      await insert({ parent: `${path}/sub`, trashedAt: Date.now() }),
      await insert({ parent: `${path}/sub`, purgedAt: Date.now() }),
    ]
    await insert({ parent: `${path}/sub`, dirtype: DirType.USER_FOLDER, size: 999 })

    expect(await repo.computeSourceBytes(root)).toBe(30)
    expect(await repo.findShareChildMatter(root, direct.id)).toMatchObject({ id: direct.id })
    expect(await repo.findShareChildMatter(root, nested.id)).toMatchObject({ id: nested.id })
    for (const child of excluded) {
      expect(await repo.findShareChildMatter(root, child.id)).toBeNull()
    }
  })
})

async function seedMatter(db: ReturnType<typeof buildDb>, orgId: string, dirtype = DirType.FILE) {
  const now = new Date()
  const matter = {
    id: generateId(),
    orgId,
    alias: generateId(10),
    name: `cf-test-${generateId(6)}`,
    type: dirtype !== DirType.FILE ? 'folder' : 'application/pdf',
    size: 0,
    dirtype,
    parent: '',
    object: dirtype !== DirType.FILE ? '' : `objects/${generateId()}`,
    storageId: 'storage-1',
    status: 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(matters).values(matter)
  return matter
}

// ─── Atomic counter race tests on D1 ─────────────────────────────────────────

describe('[CF] incrementDownloadsAtomic — race conditions on D1', () => {
  it('enforces download limit under 50 concurrent calls (limit=10)', async () => {
    const db = buildDb()
    const orgId = generateId()
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'cf-user-1',
      kind: 'landing',
      downloadLimit: 10,
    })

    const results = await Promise.all(Array.from({ length: 50 }, () => incrementDownloadsAtomic(db, share.id)))

    const successCount = results.filter((r) => r.ok).length
    expect(successCount).toBe(10)
  })

  it('returns ok=false for all calls when share is revoked', async () => {
    const db = buildDb()
    const orgId = generateId()
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'cf-user-2',
      kind: 'landing',
    })
    await revokeShareByToken(db, share.token, 'cf-user-2')

    const results = await Promise.all(Array.from({ length: 5 }, () => incrementDownloadsAtomic(db, share.id)))
    expect(results.every((r) => !r.ok)).toBe(true)
  })

  it('returns ok=false for all calls when share is expired', async () => {
    const db = buildDb()
    const orgId = generateId()
    const matter = await seedMatter(db, orgId)

    const pastDate = new Date(Date.now() - 5000)
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'cf-user-3',
      kind: 'landing',
      expiresAt: pastDate,
    })

    const results = await Promise.all(Array.from({ length: 5 }, () => incrementDownloadsAtomic(db, share.id)))
    expect(results.every((r) => !r.ok)).toBe(true)
  })
})

// ─── revokeByMatter on D1 ────────────────────────────────────────────────────

describe('[CF] revokeByMatter on D1', () => {
  it('revokes shares without deleting their history', async () => {
    const db = buildDb()
    const orgId = generateId()
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'cf-cascade-user',
      kind: 'landing',
      recipients: [{ recipientEmail: 'cascade@example.com' }],
    })

    await revokeByMatter(db, matter.id)

    expect((await resolveShareByToken(db, share.token)).status).toBe('revoked')
  })
})
