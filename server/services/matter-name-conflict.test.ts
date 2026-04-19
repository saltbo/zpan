import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus } from '../../shared/constants'
import { createTestApp } from '../test/setup.js'
import {
  applyConflictResolution,
  commitConflictPlan,
  findActiveConflict,
  NameConflictError,
  planConflictResolution,
} from './matter-name-conflict.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function insertStorage(db: TestDb, id = 'st-1') {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, 'Test', 'private', 'bucket', 'https://s3.example.com', 'us-east-1', 'K', 'S', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertMatter(
  db: TestDb,
  opts: {
    id?: string
    orgId: string
    name: string
    parent?: string
    dirtype?: number
    status?: string
    storageId?: string
  },
) {
  const id = opts.id ?? nanoid()
  const now = Date.now()
  const status = opts.status ?? ObjectStatus.ACTIVE
  const dirtype = opts.dirtype ?? DirType.FILE
  const storageId = opts.storageId ?? 'st-1'
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${opts.orgId}, ${`${id}-alias`}, ${opts.name}, 'text/plain', 0, ${dirtype}, ${opts.parent ?? ''}, '', ${storageId}, ${status}, ${now}, ${now})
  `)
  return id
}

// ─── findActiveConflict ───────────────────────────────────────────────────────

describe('findActiveConflict', () => {
  it('returns null when no sibling exists', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const result = await findActiveConflict(db, 'org-1', '', 'report.pdf')
    expect(result).toBeNull()
  })

  it('returns the conflicting row when an active sibling has the same name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'report.pdf' })

    const result = await findActiveConflict(db, orgId, '', 'report.pdf')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('report.pdf')
  })

  it('matches case-insensitively (existing "Report.pdf" vs incoming "report.pdf")', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'Report.pdf' })

    const result = await findActiveConflict(db, orgId, '', 'report.pdf')
    expect(result).not.toBeNull()
    expect(result?.name).toBe('Report.pdf')
  })

  it('does not match items in a different parent', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'file.txt', parent: 'folderA' })

    const result = await findActiveConflict(db, orgId, 'folderB', 'file.txt')
    expect(result).toBeNull()
  })

  it('does not match items in a different org', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    await insertMatter(db, { orgId: 'org-other', name: 'file.txt' })

    const result = await findActiveConflict(db, 'org-mine', '', 'file.txt')
    expect(result).toBeNull()
  })

  it('does not match trashed items with the same name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'gone.txt', status: ObjectStatus.TRASHED })

    const result = await findActiveConflict(db, orgId, '', 'gone.txt')
    expect(result).toBeNull()
  })

  it('excludes a specific id when excludeId is provided', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await insertMatter(db, { orgId, name: 'self.txt' })

    // Same row should not conflict with itself (rename-in-place)
    const result = await findActiveConflict(db, orgId, '', 'self.txt', id)
    expect(result).toBeNull()
  })
})

// ─── applyConflictResolution ──────────────────────────────────────────────────

describe('applyConflictResolution — no conflict', () => {
  it('returns the original name unchanged when no sibling exists', async () => {
    const { db } = await createTestApp()
    const result = await applyConflictResolution(db, 'org-1', '', 'unique.txt', 'fail')
    expect(result).toBe('unique.txt')
  })

  it('returns the original name when strategy is rename and there is no conflict', async () => {
    const { db } = await createTestApp()
    const result = await applyConflictResolution(db, 'org-1', '', 'unique.txt', 'rename')
    expect(result).toBe('unique.txt')
  })

  it('returns the original name when strategy is replace and there is no conflict', async () => {
    const { db } = await createTestApp()
    const result = await applyConflictResolution(db, 'org-1', '', 'unique.txt', 'replace')
    expect(result).toBe('unique.txt')
  })
})

describe('applyConflictResolution — strategy: fail', () => {
  it('throws NameConflictError when an active sibling exists', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'report.pdf' })

    await expect(applyConflictResolution(db, orgId, '', 'report.pdf', 'fail')).rejects.toThrow(NameConflictError)
    await expect(applyConflictResolution(db, orgId, '', 'report.pdf', 'fail')).rejects.toMatchObject({
      conflictingName: 'report.pdf',
      conflictingId: existingId,
    })
  })

  it('throws NameConflictError on case-insensitive match', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'NOTES.TXT' })

    await expect(applyConflictResolution(db, orgId, '', 'notes.txt', 'fail')).rejects.toThrow(NameConflictError)
  })

  it('NameConflictError has the right message', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'conflict.pdf' })

    await expect(applyConflictResolution(db, orgId, '', 'conflict.pdf', 'fail')).rejects.toThrow(
      "An item named 'conflict.pdf' already exists in this location",
    )
  })
})

describe('applyConflictResolution — strategy: rename', () => {
  it('appends (1) for the first duplicate', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'report.pdf' })

    const result = await applyConflictResolution(db, orgId, '', 'report.pdf', 'rename')
    expect(result).toBe('report (1).pdf')
  })

  it('appends (2) when (1) is already taken', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'report.pdf' })
    await insertMatter(db, { orgId, name: 'report (1).pdf' })

    const result = await applyConflictResolution(db, orgId, '', 'report.pdf', 'rename')
    expect(result).toBe('report (2).pdf')
  })

  it('preserves file extension when renaming', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'photo.jpg' })

    const result = await applyConflictResolution(db, orgId, '', 'photo.jpg', 'rename')
    expect(result).toBe('photo (1).jpg')
  })

  it('handles dot-prefix names (.env → .env (1)) without splitting the extension', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: '.env' })

    const result = await applyConflictResolution(db, orgId, '', '.env', 'rename')
    expect(result).toBe('.env (1)')
  })

  it('handles folder names (no extension) by appending suffix to full name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'Documents', dirtype: DirType.USER_FOLDER })

    const result = await applyConflictResolution(db, orgId, '', 'Documents', 'rename', { isFolder: true })
    expect(result).toBe('Documents (1)')
  })

  it('respects excludeId so rename-in-place (A → A) passes through unchanged', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await insertMatter(db, { orgId, name: 'note.txt' })

    const result = await applyConflictResolution(db, orgId, '', 'note.txt', 'rename', { excludeId: id })
    expect(result).toBe('note.txt')
  })
})

describe('applyConflictResolution — strategy: replace', () => {
  it('trashes the existing active file and returns the original name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'data.csv' })

    const result = await applyConflictResolution(db, orgId, '', 'data.csv', 'replace', { isFolder: false })
    expect(result).toBe('data.csv')

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${existingId}`)
    expect(rows[0].status).toBe(ObjectStatus.TRASHED)
  })

  it('sets trashedAt on the replaced file', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'old.txt' })

    await applyConflictResolution(db, orgId, '', 'old.txt', 'replace', { isFolder: false })

    const rows = await db.all<{ trashed_at: number | null }>(
      sql`SELECT trashed_at FROM matters WHERE id = ${existingId}`,
    )
    expect(rows[0].trashed_at).not.toBeNull()
  })

  it('records a replace activity when userId is provided', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const userId = nanoid()
    await insertMatter(db, { orgId, name: 'report.pdf' })

    await applyConflictResolution(db, orgId, '', 'report.pdf', 'replace', { isFolder: false, userId })

    const rows = await db.all<{ action: string }>(
      sql`SELECT action FROM activity_events WHERE org_id = ${orgId} AND user_id = ${userId}`,
    )
    expect(rows[0].action).toBe('replace')
  })

  it('does not record activity when userId is omitted', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'report.pdf' })

    await applyConflictResolution(db, orgId, '', 'report.pdf', 'replace', { isFolder: false })

    const rows = await db.all<{ action: string }>(sql`SELECT action FROM activity_events WHERE org_id = ${orgId}`)
    expect(rows).toHaveLength(0)
  })

  it('throws NameConflictError when incoming item is a folder', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'Docs' })

    await expect(applyConflictResolution(db, orgId, '', 'Docs', 'replace', { isFolder: true })).rejects.toThrow(
      NameConflictError,
    )
  })

  it('throws NameConflictError when existing item is a folder', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await insertMatter(db, { orgId, name: 'Docs', dirtype: DirType.USER_FOLDER })

    await expect(applyConflictResolution(db, orgId, '', 'Docs', 'replace', { isFolder: false })).rejects.toThrow(
      NameConflictError,
    )
  })
})

describe('NameConflictError', () => {
  it('has name "NameConflictError"', () => {
    const err = new NameConflictError('file.txt', 'id-1')
    expect(err.name).toBe('NameConflictError')
  })

  it('exposes conflictingName and conflictingId', () => {
    const err = new NameConflictError('data.csv', 'abc123')
    expect(err.conflictingName).toBe('data.csv')
    expect(err.conflictingId).toBe('abc123')
  })

  it('is an instance of Error', () => {
    const err = new NameConflictError('x', 'y')
    expect(err).toBeInstanceOf(Error)
  })
})

// ─── planConflictResolution ───────────────────────────────────────────────────

describe('planConflictResolution — no conflict', () => {
  it('returns { finalName: name, toTrash: null } when no active sibling exists (replace)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const plan = await planConflictResolution(db, 'org-1', '', 'unique.txt', 'replace')
    expect(plan.finalName).toBe('unique.txt')
    expect(plan.toTrash).toBeNull()
  })

  it('returns { finalName: name, toTrash: null } when no active sibling exists (rename)', async () => {
    const { db } = await createTestApp()
    const plan = await planConflictResolution(db, 'org-1', '', 'unique.txt', 'rename')
    expect(plan.finalName).toBe('unique.txt')
    expect(plan.toTrash).toBeNull()
  })

  it('returns { finalName: name, toTrash: null } when no active sibling exists (fail)', async () => {
    const { db } = await createTestApp()
    const plan = await planConflictResolution(db, 'org-1', '', 'unique.txt', 'fail')
    expect(plan.finalName).toBe('unique.txt')
    expect(plan.toTrash).toBeNull()
  })
})

describe('planConflictResolution — strategy: replace', () => {
  it('does NOT mutate DB — incumbent remains active after plan call', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'data.csv' })

    await planConflictResolution(db, orgId, '', 'data.csv', 'replace')

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${existingId}`)
    expect(rows[0].status).toBe(ObjectStatus.ACTIVE)
  })

  it('returns toTrash pointing to the conflicting row', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'data.csv' })

    const plan = await planConflictResolution(db, orgId, '', 'data.csv', 'replace')

    expect(plan.toTrash).not.toBeNull()
    expect(plan.toTrash?.id).toBe(existingId)
    expect(plan.finalName).toBe('data.csv')
  })
})

// ─── commitConflictPlan ───────────────────────────────────────────────────────

describe('commitConflictPlan', () => {
  it('is a no-op when toTrash is null — no error and no DB writes', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'safe.txt' })

    await expect(commitConflictPlan(db, orgId, { finalName: 'safe.txt', toTrash: null })).resolves.toBeUndefined()

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${existingId}`)
    expect(rows[0].status).toBe(ObjectStatus.ACTIVE)
  })

  it('trashes the toTrash row when provided', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await insertMatter(db, { orgId, name: 'old.txt' })

    const plan = await planConflictResolution(db, orgId, '', 'old.txt', 'replace')
    await commitConflictPlan(db, orgId, plan)

    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${existingId}`)
    expect(rows[0].status).toBe(ObjectStatus.TRASHED)
  })
})
