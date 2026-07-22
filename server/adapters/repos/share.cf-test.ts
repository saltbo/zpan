import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { DirType } from '../../../shared/constants'
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

async function seedMatter(db: ReturnType<typeof buildDb>, orgId: string, dirtype = DirType.FILE) {
  const now = new Date()
  const matter = {
    id: nanoid(),
    orgId,
    alias: nanoid(10),
    name: `cf-test-${nanoid(6)}`,
    type: dirtype !== DirType.FILE ? 'folder' : 'application/pdf',
    size: 0,
    dirtype,
    parent: '',
    object: dirtype !== DirType.FILE ? '' : `objects/${nanoid()}`,
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
    const orgId = `org-${nanoid(6)}`
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
    const orgId = `org-${nanoid(6)}`
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
    const orgId = `org-${nanoid(6)}`
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
    const orgId = `org-${nanoid(6)}`
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
