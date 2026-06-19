import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DirType } from '../../shared/constants'
import type { CreateShareInput } from '../../shared/schemas/share'
import { S3Service } from '../adapters/gateways/s3.js'
import { createActivityRepo } from '../adapters/repos/activity.js'
import { createMatterRepo } from '../adapters/repos/matter.js'
import { createQuotaRepo } from '../adapters/repos/quota.js'
import { createShareRepo } from '../adapters/repos/share.js'
import { createStorageRepo } from '../adapters/repos/storage.js'
import { createStorageUsageRepo } from '../adapters/repos/storage-usage.js'
import { activityEvents, matters, orgQuotaEntitlements, orgQuotas, shares } from '../db/schema'
import type { Database } from '../platform/interface'
import { authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'
import {
  DEFAULT_TRASH_RETENTION_DAYS,
  purgeExpiredTrash,
  resolveTrashRetentionDays,
  type SaveShareInput,
  type SaveToDriveDeps,
  saveShareToDrive as saveShareToDriveUseCase,
} from './object.js'
import type { Matter } from './ports'

const createShare = (db: Database, input: CreateShareInput) => createShareRepo(db).create(input)
const resolveShareByToken = (db: Database, token: string) => createShareRepo(db).resolveByToken(token)
const computeSourceBytes = (db: Database, matter: Matter) => createShareRepo(db).computeSourceBytes(matter)
const isQuotaSufficient = (db: Database, orgId: string, bytes: number) =>
  createShareRepo(db).hasQuotaForBytes(orgId, bytes)
// The usecase reaches the world through deps; build the subset it needs from the
// same db so reservation/storage/activity side effects land in the test database.
function saveToDriveDeps(db: Database): SaveToDriveDeps {
  return {
    s3: new S3Service(),
    storages: createStorageRepo(db),
    storageUsage: createStorageUsageRepo(db),
    quota: createQuotaRepo(db),
    activity: createActivityRepo(db),
    share: createShareRepo(db),
    matter: createMatterRepo(db),
  }
}
const saveShareToDrive = (db: Database, input: SaveShareInput) => saveShareToDriveUseCase(saveToDriveDeps(db), input)

// ─── Test fixtures ────────────────────────────────────────────────────────────

const STORAGE_ID = 'st-save-1'
const ALT_STORAGE_ID = 'st-save-2'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertStorage(db: TestDb, id = STORAGE_ID) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'Test S3', 'private', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function seedMatter(
  db: TestDb,
  opts: {
    orgId: string
    storageId?: string
    dirtype?: number
    status?: string
    name?: string
    parent?: string
    size?: number
  },
) {
  const now = new Date()
  const dirtype = opts.dirtype ?? DirType.FILE
  const matter = {
    id: nanoid(),
    orgId: opts.orgId,
    alias: nanoid(10),
    name: opts.name ?? `file-${nanoid(6)}.pdf`,
    type: dirtype !== DirType.FILE ? 'folder' : 'application/pdf',
    size: opts.size ?? 1024,
    dirtype,
    parent: opts.parent ?? '',
    object: dirtype !== DirType.FILE ? '' : `objects/${nanoid()}.pdf`,
    storageId: opts.storageId ?? STORAGE_ID,
    status: opts.status ?? 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(matters).values(matter)
  return matter
}

async function seedOrgQuota(db: TestDb, orgId: string, quota: number, used = 0) {
  await db.insert(orgQuotas).values({
    id: nanoid(),
    orgId,
    quota: 0,
    used,
    trafficQuota: 0,
    trafficUsed: 0,
    trafficPeriod: '2026-05',
  })
  if (quota > 0) {
    const now = new Date()
    await db.insert(orgQuotaEntitlements).values({
      id: nanoid(),
      orgId,
      resourceType: 'storage',
      entitlementType: 'plan',
      source: 'test',
      sourceId: `test-storage-plan:${orgId}:${nanoid()}`,
      bytes: quota,
      startsAt: new Date(),
      expiresAt: null,
      status: 'active',
      metadata: JSON.stringify({ packageName: 'Test Plan' }),
      createdAt: now,
      updatedAt: now,
    })
  }
}

async function getShare(db: TestDb, shareId: string) {
  const rows = await db.select().from(shares).where(sql`id = ${shareId}`)
  return rows[0] ?? null
}

async function getActivities(db: TestDb, orgId: string) {
  return db.select().from(activityEvents).where(sql`org_id = ${orgId}`)
}

async function getMattersInOrg(db: TestDb, orgId: string) {
  return db.select().from(matters).where(sql`org_id = ${orgId} AND status = 'active'`)
}

// ─── resolveShareByToken ──────────────────────────────────────────────────────

describe('resolveShareByToken', () => {
  it('returns ok with share, matter, and recipients', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      recipients: [{ recipientUserId: 'u2' }],
    })

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.share.id).toBe(share.id)
    expect(result.matter.id).toBe(matter.id)
    expect(result.recipients).toHaveLength(1)
  })

  it('returns not_found for unknown token', async () => {
    const { db } = await createTestApp()
    const result = await resolveShareByToken(db, 'unknown')
    expect(result.status).toBe('not_found')
  })

  it('returns revoked for revoked share', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })
    await db.run(sql`UPDATE shares SET status = 'revoked' WHERE id = ${share.id}`)

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('revoked')
  })

  it('returns matter_trashed when underlying matter is trashed', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId, status: 'active' })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })
    await db.run(sql`UPDATE matters SET trashed_at = ${Date.now()} WHERE id = ${matter.id}`)

    const result = await resolveShareByToken(db, share.token)
    expect(result.status).toBe('matter_trashed')
  })
})

// ─── computeSourceBytes ───────────────────────────────────────────────────────

describe('computeSourceBytes', () => {
  it('returns file size for a single file matter', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId, size: 5000 })
    const bytes = await computeSourceBytes(db, matter)
    expect(bytes).toBe(5000)
  })

  it('returns sum of all files in a folder tree', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const folder = await seedMatter(db, { orgId, dirtype: DirType.USER_FOLDER, name: 'Photos', size: 0 })
    const folderPath = folder.name
    await seedMatter(db, { orgId, parent: folderPath, size: 1000 })
    await seedMatter(db, { orgId, parent: folderPath, size: 2000 })

    const bytes = await computeSourceBytes(db, folder)
    expect(bytes).toBe(3000)
  })

  it('returns 0 for empty folder', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const folder = await seedMatter(db, { orgId, dirtype: DirType.USER_FOLDER, name: 'Empty', size: 0 })
    const bytes = await computeSourceBytes(db, folder)
    expect(bytes).toBe(0)
  })
})

// ─── isQuotaSufficient ────────────────────────────────────────────────────────

describe('isQuotaSufficient', () => {
  it('returns true when no quota row exists (unlimited)', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    expect(await isQuotaSufficient(db, orgId, 9999999)).toBe(true)
  })

  it('returns true when quota is 0 (unlimited)', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await seedOrgQuota(db, orgId, 0)
    expect(await isQuotaSufficient(db, orgId, 9999999)).toBe(true)
  })

  it('returns true when bytes fit within quota', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await seedOrgQuota(db, orgId, 10000, 0)
    expect(await isQuotaSufficient(db, orgId, 5000)).toBe(true)
  })

  it('returns false when bytes exceed remaining quota', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await seedOrgQuota(db, orgId, 10000, 9500)
    expect(await isQuotaSufficient(db, orgId, 600)).toBe(false)
  })
})

// ─── saveShareToDrive ─────────────────────────────────────────────────────────

describe('saveShareToDrive', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)
  })

  it('saves a single file to target org (same storage)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const matter = await seedMatter(db, { orgId: srcOrgId, size: 2048 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')

    const result = await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    expect(result.saved).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
    expect(result.saved[0].orgId).toBe(dstOrgId)
    expect(result.saved[0].name).toBe(matter.name)
    expect(result.saved[0].status).toBe('active')
  })

  it('uses streamCopy for cross-storage save', async () => {
    const { db } = await createTestApp()
    // STORAGE_ID is the source storage; make it full so selectStorage skips it as target
    await insertStorage(db, STORAGE_ID)
    await insertStorage(db, ALT_STORAGE_ID)
    // Mark source storage as at capacity so selectStorage picks ALT_STORAGE_ID as target
    await db.run(sql`UPDATE storages SET capacity = 1, used = 1 WHERE id = ${STORAGE_ID}`)

    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const matter = await seedMatter(db, { orgId: srcOrgId, storageId: STORAGE_ID, size: 1024 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    const streamCopySpy = vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)

    if (share.status === 'revoked') throw new Error('test setup failed')

    await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    // copyObject (same-storage) must NOT have been used; streamCopy MUST have been called
    expect(streamCopySpy).toHaveBeenCalled()
  })

  it('auto-renames file when name already exists in target org', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const fileName = `photo-${nanoid(4)}.pdf`
    const matter = await seedMatter(db, { orgId: srcOrgId, name: fileName, size: 1024 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    // Pre-create a file with the same name in the target org
    await seedMatter(db, { orgId: dstOrgId, name: fileName })

    if (share.status === 'revoked') throw new Error('test setup failed')

    const result = await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    expect(result.saved).toHaveLength(1)
    // Name should have been renamed (not equal to original)
    expect(result.saved[0].name).not.toBe(fileName)
    expect(result.saved[0].name).toContain('photo-')
  })

  it('records activity with save_from_share action', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const matter = await seedMatter(db, { orgId: srcOrgId, size: 512 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')

    await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    const activities = await getActivities(db, dstOrgId)
    expect(activities).toHaveLength(1)
    expect(activities[0].action).toBe('save_from_share')
    expect(activities[0].userId).toBe('u2')

    const metadata = JSON.parse(activities[0].metadata ?? '{}')
    expect(metadata.sourceShareId).toBe(share.id)
  })

  it('does NOT increment share downloads counter', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const matter = await seedMatter(db, { orgId: srcOrgId, size: 512 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    if (share.status === 'revoked') throw new Error('test setup failed')

    const downloadsBefore = share.downloads

    await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    const updatedShare = await getShare(db, share.id)
    expect(updatedShare?.downloads).toBe(downloadsBefore)
  })

  it('increments target org quota usage after save', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const fileSize = 4096
    const matter = await seedMatter(db, { orgId: srcOrgId, size: fileSize })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    // Set up a quota row for target org
    await seedOrgQuota(db, dstOrgId, 100000, 0)

    if (share.status === 'revoked') throw new Error('test setup failed')

    await saveShareToDrive(db, {
      share,
      matter,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    const rows = await db.select().from(orgQuotas).where(sql`org_id = ${dstOrgId}`)
    expect(rows[0]?.used).toBe(fileSize)
  })

  it('rolls back target usage when storage copy fails after quota reservation', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const fileSize = 2048
    const matter = await seedMatter(db, { orgId: srcOrgId, size: fileSize })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })
    await seedOrgQuota(db, dstOrgId, 100000, 128)
    await db.run(sql`UPDATE storages SET used = 128 WHERE id = ${STORAGE_ID}`)
    vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

    if (share.status === 'revoked') throw new Error('test setup failed')

    await expect(
      saveShareToDrive(db, {
        share,
        matter,
        currentUserId: 'u2',
        targetOrgId: dstOrgId,
        targetParent: '',
      }),
    ).rejects.toThrow('copy failed')

    const quotaRows = await db.select().from(orgQuotas).where(sql`org_id = ${dstOrgId}`)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    const dstMatters = await getMattersInOrg(db, dstOrgId)
    expect(quotaRows[0]?.used).toBe(128)
    expect(storageRows[0]?.used).toBe(128)
    expect(dstMatters).toHaveLength(0)
  })

  it('recursively copies a folder tree to target org', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()

    // Build source tree: Photos/ → [img1.jpg, img2.jpg, Sub/ → [img3.jpg]]
    const folder = await seedMatter(db, { orgId: srcOrgId, dirtype: DirType.USER_FOLDER, name: 'Photos', size: 0 })
    await seedMatter(db, { orgId: srcOrgId, parent: 'Photos', name: 'img1.jpg', size: 100 })
    await seedMatter(db, { orgId: srcOrgId, parent: 'Photos', name: 'img2.jpg', size: 200 })
    const sub = await seedMatter(db, {
      orgId: srcOrgId,
      dirtype: DirType.USER_FOLDER,
      parent: 'Photos',
      name: 'Sub',
      size: 0,
    })
    await seedMatter(db, { orgId: srcOrgId, parent: 'Photos/Sub', name: 'img3.jpg', size: 300 })

    const share = await createShare(db, { matterId: folder.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    if (share.status === 'revoked' || !sub) throw new Error('test setup failed')

    const result = await saveShareToDrive(db, {
      share,
      matter: folder,
      currentUserId: 'u2',
      targetOrgId: dstOrgId,
      targetParent: '',
    })

    expect(result.skipped).toHaveLength(0)
    // 1 root folder + 1 sub folder + 3 files = 5
    expect(result.saved).toHaveLength(5)

    const dstMatters = await getMattersInOrg(db, dstOrgId)
    expect(dstMatters).toHaveLength(5)

    const dstFolder = dstMatters.find((m) => m.dirtype !== DirType.FILE && m.parent === '')
    expect(dstFolder?.name).toBe('Photos')
  })

  it('quota check blocks file save when quota exceeded atomically', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()
    const dstOrgId = nanoid()
    const matter = await seedMatter(db, { orgId: srcOrgId, size: 5000 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    // Set quota below file size
    await seedOrgQuota(db, dstOrgId, 1000, 0)

    if (share.status === 'revoked') throw new Error('test setup failed')

    // The service's atomic increment will catch quota exceeded
    await expect(
      saveShareToDrive(db, {
        share,
        matter,
        currentUserId: 'u2',
        targetOrgId: dstOrgId,
        targetParent: '',
      }),
    ).rejects.toThrow('QUOTA_EXCEEDED')

    // No matters should have been created
    const dstMatters = await getMattersInOrg(db, dstOrgId)
    expect(dstMatters).toHaveLength(0)
  })
})

// ─── Route-level integration tests ───────────────────────────────────────────

describe('POST /api/shares/:token/objects', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'streamCopy').mockResolvedValue(undefined)
  })

  async function setup() {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    const srcOrgId = nanoid()

    const matter = await seedMatter(db, { orgId: srcOrgId, size: 512 })
    const share = await createShare(db, { matterId: matter.id, orgId: srcOrgId, creatorId: 'u1', kind: 'landing' })

    // Create an authenticated user with their personal org
    const headers = await authedHeaders(app)

    // Get the user's personal org ID
    const sessionRes = await app.request('/api/auth/get-session', { headers: new Headers(headers) })
    const sessionData = (await sessionRes.json()) as { user?: { id?: string } }
    const userId: string = sessionData?.user?.id ?? ''

    const orgRows = await db.all<{ id: string }>(sql`
      SELECT id FROM organization WHERE slug LIKE ${`personal-${userId}`} LIMIT 1
    `)
    const personalOrgId = orgRows[0]?.id ?? ''

    return { app, db, share, matter, srcOrgId, headers, personalOrgId }
  }

  it('returns 401 without authentication', async () => {
    const { app, share } = await setup()
    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrgId: 'any-org' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown token', async () => {
    const { app, headers, personalOrgId } = await setup()
    const res = await app.request('/api/shares/nonexistent-tok/objects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 410 when shared matter is trashed', async () => {
    const { app, db, share, matter, headers, personalOrgId } = await setup()
    await db.run(sql`UPDATE matters SET trashed_at = ${Date.now()} WHERE id = ${matter.id}`)

    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(410)
  })

  it('returns 404 when share is revoked', async () => {
    const { app, db, share, headers, personalOrgId } = await setup()
    await db.run(sql`UPDATE shares SET status = 'revoked' WHERE id = ${share.id}`)

    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 DIRECT_SAVE_FORBIDDEN for direct-kind shares', async () => {
    const { app, db, headers, personalOrgId } = await setup()
    const srcOrgId = nanoid()
    const m = await seedMatter(db, { orgId: srcOrgId })
    const directShare = await createShare(db, { matterId: m.id, orgId: srcOrgId, creatorId: 'u1', kind: 'direct' })

    const res = await app.request(`/api/shares/${directShare.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string; details: { reason: string }[] } }
    expect(body.error.message).toBe('Direct link shares cannot be saved. Ask the sender for a landing share.')
    expect(body.error.details[0].reason).toBe('DIRECT_SAVE_FORBIDDEN')
  })

  it('returns 401 when password-protected share requires cookie and user is not recipient', async () => {
    const { app, db, headers, personalOrgId } = await setup()
    const srcOrgId = nanoid()
    const m = await seedMatter(db, { orgId: srcOrgId })
    const pwShare = await createShare(db, {
      matterId: m.id,
      orgId: srcOrgId,
      creatorId: 'u1',
      kind: 'landing',
      password: 'secret123',
    })

    const res = await app.request(`/api/shares/${pwShare.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(401)
  })

  it('allows recipient to save password-protected share without cookie', async () => {
    const { app, db, headers, personalOrgId } = await setup()

    // Get the current user's ID
    const sessionRes = await app.request('/api/auth/get-session', { headers: new Headers(headers) })
    const sessionData = (await sessionRes.json()) as { user?: { id?: string } }
    const userId: string = sessionData?.user?.id ?? ''

    const srcOrgId = nanoid()
    const m = await seedMatter(db, { orgId: srcOrgId, size: 256 })
    const pwShare = await createShare(db, {
      matterId: m.id,
      orgId: srcOrgId,
      creatorId: 'u1',
      kind: 'landing',
      password: 'secret123',
      recipients: [{ recipientUserId: userId }],
    })

    const res = await app.request(`/api/shares/${pwShare.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 403 when user has viewer role in target org', async () => {
    const { app, db, share, headers } = await setup()

    // Create an org where the current user has viewer role
    const viewerOrgId = nanoid()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, created_at) VALUES (${viewerOrgId}, 'Test Org', ${nanoid()}, ${Date.now()})
    `)

    // Get user ID
    const sessionRes = await app.request('/api/auth/get-session', { headers: new Headers(headers) })
    const sessionData = (await sessionRes.json()) as { user?: { id?: string } }
    const userId: string = sessionData?.user?.id ?? ''

    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${nanoid()}, ${viewerOrgId}, ${userId}, 'viewer', ${Date.now()})
    `)

    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: viewerOrgId }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 422 QUOTA_EXCEEDED when target org has insufficient quota', async () => {
    const { app, db, share, headers } = await setup()
    await seedProLicense(db)

    // Get the current user's ID to add them as editor in the quota-restricted org
    const sessionRes = await app.request('/api/auth/get-session', { headers: new Headers(headers) })
    const sessionData = (await sessionRes.json()) as { user?: { id?: string } }
    const userId: string = sessionData?.user?.id ?? ''

    // Create a fresh org with a tight quota (avoids the auto-created personal-org quota)
    const quotaOrgId = nanoid()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${quotaOrgId}, 'Quota Org', ${nanoid()}, ${Date.now()})
    `)
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${nanoid()}, ${quotaOrgId}, ${userId}, 'editor', ${Date.now()})
    `)
    // Insert a tight quota row for this org (only 100 bytes allowed)
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId: quotaOrgId,
      quota: 0,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const now = new Date()
    await db.insert(orgQuotaEntitlements).values({
      id: nanoid(),
      orgId: quotaOrgId,
      resourceType: 'storage',
      entitlementType: 'plan',
      source: 'test',
      sourceId: `test-storage-plan:${quotaOrgId}:${nanoid()}`,
      bytes: 100,
      startsAt: new Date(),
      expiresAt: null,
      status: 'active',
      metadata: JSON.stringify({ packageName: 'Test Plan' }),
      createdAt: now,
      updatedAt: now,
    })

    // The share from setup() has a matter with size 512 — well above the 100-byte quota
    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: quotaOrgId }),
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { message: string; status: string; details: { reason: string }[] } }
    expect(body.error.message).toBe('Quota exceeded')
    expect(body.error.status).toBe('RESOURCE_EXHAUSTED')
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
  })

  it('successfully saves a landing single-file share', async () => {
    const { app, share, headers, personalOrgId } = await setup()

    const res = await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ orgId: string }> }
    expect(body.saved).toHaveLength(1)
    expect(body.saved[0].orgId).toBe(personalOrgId)
  })

  it('downloads counter does NOT increment after save', async () => {
    const { app, db, share, headers, personalOrgId } = await setup()

    const downloadsBefore = share.downloads

    await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })

    const updatedShare = await getShare(db, share.id)
    expect(updatedShare?.downloads).toBe(downloadsBefore)
  })

  it('activity_events row created with save_from_share and sourceShareId metadata', async () => {
    const { app, db, share, headers, personalOrgId } = await setup()

    await app.request(`/api/shares/${share.token}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetOrgId: personalOrgId }),
    })

    const activities = await getActivities(db, personalOrgId)
    expect(activities.length).toBeGreaterThan(0)

    const saveActivity = activities.find((a) => a.action === 'save_from_share')
    expect(saveActivity).toBeTruthy()
    const metadata = JSON.parse(saveActivity?.metadata ?? '{}')
    expect(metadata.sourceShareId).toBe(share.id)
  })
})

// ── trash purge (purgeExpiredTrash — formerly purge.ts) ──────────────────────

describe('trash purge', () => {
  type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

  function getMatter(db: TestDb, id: string, orgId: string) {
    return createMatterRepo(db).get(id, orgId)
  }

  const DAY_MS = 24 * 60 * 60 * 1000

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  })

  async function insertStorage(db: TestDb) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('st-1', 'Test S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'AKID', 'SECRET', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
  }

  async function insertOrg(db: TestDb, orgId: string) {
    await db.run(sql`
      INSERT INTO organization (id, name, slug, created_at)
      VALUES (${orgId}, 'Org', ${`org-${orgId}`}, ${Date.now()})
    `)
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES (${nanoid()}, ${orgId}, ${1024 * 1024}, 0, 0, 0, '1970-01')
    `)
  }

  async function insertFile(
    db: TestDb,
    orgId: string,
    opts: { id: string; size: number; status: 'active'; trashedAt?: number },
  ) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
      VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${`${opts.id}.txt`}, 'text/plain', ${opts.size}, 0, '', ${`key/${opts.id}`}, 'st-1', ${opts.status}, ${opts.trashedAt ?? null}, ${now}, ${now})
    `)
  }

  async function getUsed(db: TestDb, orgId: string): Promise<number> {
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
    return rows[0]?.used ?? 0
  }

  describe('resolveTrashRetentionDays', () => {
    it('defaults when unset, empty, or invalid', () => {
      expect(resolveTrashRetentionDays(undefined)).toBe(DEFAULT_TRASH_RETENTION_DAYS)
      expect(resolveTrashRetentionDays('')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
      expect(resolveTrashRetentionDays('abc')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
      expect(resolveTrashRetentionDays('-5')).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    })

    it('honors explicit values, including 0 (disabled)', () => {
      expect(resolveTrashRetentionDays('7')).toBe(7)
      expect(resolveTrashRetentionDays('0')).toBe(0)
    })
  })

  describe('purgeExpiredTrash', () => {
    it('purges trash older than the window and reclaims quota, keeping recent trash and active files', async () => {
      const { db, deps } = await createTestApp()
      await insertStorage(db)
      const orgId = nanoid()
      await insertOrg(db, orgId)
      const now = Date.now()
      await insertFile(db, orgId, { id: 'old', size: 100, status: 'active', trashedAt: now - 40 * DAY_MS })
      await insertFile(db, orgId, { id: 'recent', size: 200, status: 'active', trashedAt: now - 5 * DAY_MS })
      await insertFile(db, orgId, { id: 'active', size: 300, status: 'active' })

      const purged = await purgeExpiredTrash(deps, 30, now)

      expect(purged).toBe(1)
      expect(await getMatter(db, 'old', orgId)).toBeNull()
      expect((await getMatter(db, 'recent', orgId))?.trashedAt).not.toBeNull()
      expect((await getMatter(db, 'active', orgId))?.status).toBe('active')
      expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
      // reconcile counts active + trashed: recent(200) + active(300); old(100) freed.
      expect(await getUsed(db, orgId)).toBe(500)
    })

    it('is a no-op when retention is 0 (disabled)', async () => {
      const { db, deps } = await createTestApp()
      await insertStorage(db)
      const orgId = nanoid()
      await insertOrg(db, orgId)
      await insertFile(db, orgId, { id: 'old', size: 100, status: 'active', trashedAt: Date.now() - 400 * DAY_MS })

      const purged = await purgeExpiredTrash(deps, 0)

      expect(purged).toBe(0)
      expect(await getMatter(db, 'old', orgId)).not.toBeNull()
    })
  })
})
