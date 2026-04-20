import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DirType } from '../../shared/constants'
import { matters } from '../db/schema'
import { createCloudflarePlatform } from '../platform/cloudflare'
import { S3Service } from './s3'
import { saveShareToDrive } from './save-to-drive'
import { createShare, resolveShareByToken, revokeShareByToken } from './share'

function buildDb() {
  return createCloudflarePlatform(env).db
}

async function seedStorage(db: ReturnType<typeof buildDb>, id: string) {
  await db.run(
    `INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
     VALUES ('${id}', 'CF Test S3', 'private', 'cf-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKIA...', 'secret...', '', '', 0, 0, 'active', ${Date.now()}, ${Date.now()})`,
  )
}

async function seedMatter(db: ReturnType<typeof buildDb>, orgId: string, dirtype = DirType.FILE) {
  const now = new Date()
  const matter = {
    id: nanoid(),
    orgId,
    alias: nanoid(10),
    name: `cf-file-${nanoid(6)}.pdf`,
    type: dirtype !== DirType.FILE ? 'folder' : 'application/pdf',
    size: 1024,
    dirtype,
    parent: '',
    object: dirtype !== DirType.FILE ? '' : `objects/${nanoid()}.pdf`,
    storageId: 'cf-storage-1',
    status: 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(matters).values(matter)
  return matter
}

// ─── resolveShareByToken on D1 ────────────────────────────────────────────────

describe('[CF] resolveShareByToken', () => {
  it('returns ok for an active landing share', async () => {
    const db = buildDb()
    const orgId = `org-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'cf-user-1',
      kind: 'landing',
    })

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.share.id).toBe(share.id)
  })

  it('returns revoked when share is revoked', async () => {
    const db = buildDb()
    const orgId = `org-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'cf-user-2', kind: 'landing' })
    await revokeShareByToken(db, share.token, 'cf-user-2')

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('revoked')
  })

  it('returns matter_trashed when matter is trashed', async () => {
    const db = buildDb()
    const orgId = `org-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')
    const matter = await seedMatter(db, orgId)

    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'cf-user-3', kind: 'landing' })
    await db.run(`UPDATE matters SET status = 'trashed' WHERE id = '${matter.id}'`)

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('matter_trashed')
  })
})

// ─── saveShareToDrive on D1 ───────────────────────────────────────────────────

describe('[CF] saveShareToDrive — stream copy via D1', () => {
  beforeEach(() => {
    vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)
  })

  it('saves a single file to the target org on D1', async () => {
    const db = buildDb()
    const srcOrgId = `src-${nanoid(6)}`
    const dstOrgId = `dst-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')

    const matter = await seedMatter(db, srcOrgId)
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'cf-u1', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')

    const result = await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'cf-u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    expect(result.saved).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
    expect(result.saved[0].orgId).toBe(dstOrgId)
    expect(result.saved[0].status).toBe('active')
  })

  it('does not increment downloads counter after save', async () => {
    const db = buildDb()
    const srcOrgId = `src-${nanoid(6)}`
    const dstOrgId = `dst-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')

    const matter = await seedMatter(db, srcOrgId)
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'cf-u3', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')
    const downloadsBefore = share.downloads

    await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'cf-u4',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    const _rows = await db.select().from(matters).where(
      // Check that the original share downloads didn't change
    )
    // Verify by re-querying the share
    const updatedShareRows = await db.all<{ downloads: number }>(
      `SELECT downloads FROM shares WHERE id = '${share.id}'`,
    )
    expect(updatedShareRows[0]?.downloads).toBe(downloadsBefore)
  })

  it('recursively saves a folder tree on D1', async () => {
    const db = buildDb()
    const srcOrgId = `src-${nanoid(6)}`
    const dstOrgId = `dst-${nanoid(6)}`
    await seedStorage(db, 'cf-storage-1')

    // Create folder structure
    const now = new Date()
    const folder = {
      id: nanoid(),
      orgId: srcOrgId,
      alias: nanoid(10),
      name: 'cf-album',
      type: 'folder',
      size: 0,
      dirtype: DirType.USER_FOLDER,
      parent: '',
      object: '',
      storageId: 'cf-storage-1',
      status: 'active',
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(matters).values(folder)

    const file1 = {
      id: nanoid(),
      orgId: srcOrgId,
      alias: nanoid(10),
      name: 'photo1.jpg',
      type: 'image/jpeg',
      size: 500,
      dirtype: DirType.FILE,
      parent: 'cf-album',
      object: `objects/${nanoid()}.jpg`,
      storageId: 'cf-storage-1',
      status: 'active',
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(matters).values(file1)

    const share = await createShare(db, { matterId: folder.id, orgId: srcOrgId, creatorId: 'cf-u5', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')

    const result = await saveShareToDrive(db, {
      share,
      matter: folder,
      currentUserId: 'cf-u6',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    // 1 root folder + 1 file = 2
    expect(result.saved).toHaveLength(2)
    expect(result.skipped).toHaveLength(0)
  })
})
