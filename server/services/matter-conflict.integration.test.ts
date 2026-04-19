/**
 * Integration tests for name-conflict resolution across all matter service
 * entry points: createMatter, updateMatter, confirmUpload, copyMatter,
 * batchMove, restoreMatter.
 */
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { ObjectStatus } from '../../shared/constants'
import { createTestApp } from '../test/setup.js'
import { batchMove, confirmUpload, copyMatter, createMatter, restoreMatter, updateMatter } from './matter.js'
import { NameConflictError } from './matter-name-conflict.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

const STORAGE_ID = 'st-conflict'

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'Test', 'private', 'bucket', 'https://s3.example.com', 'us-east-1', 'K', 'S', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function makeFolder(db: TestDb, orgId: string, name: string, parent = '', id = nanoid()) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, ${name}, 'folder', 0, 1, ${parent}, '', ${STORAGE_ID}, 'active', ${now}, ${now})
  `)
  return id
}

async function makeFile(
  db: TestDb,
  orgId: string,
  name: string,
  opts: { parent?: string; status?: string; id?: string } = {},
) {
  const id = opts.id ?? nanoid()
  const now = Date.now()
  const status = opts.status ?? ObjectStatus.ACTIVE
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, ${name}, 'text/plain', 100, 0, ${opts.parent ?? ''}, 'key.txt', ${STORAGE_ID}, ${status}, ${now}, ${now})
  `)
  return id
}

// ─── createMatter ─────────────────────────────────────────────────────────────

describe('createMatter — name conflict', () => {
  it('throws NameConflictError when creating a folder with a duplicate name (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFolder(db, orgId, 'Docs')

    await expect(
      createMatter(db, {
        orgId,
        name: 'Docs',
        type: 'folder',
        dirtype: 1,
        object: '',
        storageId: STORAGE_ID,
        status: 'active',
      }),
    ).rejects.toThrow(NameConflictError)
  })

  it('auto-renames folder with onConflict: rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFolder(db, orgId, 'Docs')

    const matter = await createMatter(db, {
      orgId,
      name: 'Docs',
      type: 'folder',
      dirtype: 1,
      object: '',
      storageId: STORAGE_ID,
      status: 'active',
      onConflict: 'rename',
    })

    expect(matter.name).toBe('Docs (1)')
  })

  it('throws NameConflictError when onConflict: replace and incoming is a folder', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFolder(db, orgId, 'Assets')

    await expect(
      createMatter(db, {
        orgId,
        name: 'Assets',
        type: 'folder',
        dirtype: 1,
        object: '',
        storageId: STORAGE_ID,
        status: 'active',
        onConflict: 'replace',
      }),
    ).rejects.toThrow(NameConflictError)
  })

  it('throws NameConflictError for duplicate active file name (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFile(db, orgId, 'report.pdf')

    await expect(
      createMatter(db, {
        orgId,
        name: 'report.pdf',
        type: 'application/pdf',
        object: 'some/key.pdf',
        storageId: STORAGE_ID,
        status: 'draft',
      }),
    ).rejects.toThrow(NameConflictError)
  })

  it('renames duplicate file with onConflict: rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFile(db, orgId, 'photo.jpg')

    const matter = await createMatter(db, {
      orgId,
      name: 'photo.jpg',
      type: 'image/jpeg',
      object: 'some/key.jpg',
      storageId: STORAGE_ID,
      status: 'draft',
      onConflict: 'rename',
    })

    expect(matter.name).toBe('photo (1).jpg')
  })

  it('replaces existing file with onConflict: replace (existing becomes trashed)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const existingId = await makeFile(db, orgId, 'data.csv')

    const matter = await createMatter(db, {
      orgId,
      name: 'data.csv',
      type: 'text/csv',
      object: 'some/data.csv',
      storageId: STORAGE_ID,
      status: 'draft',
      onConflict: 'replace',
    })

    expect(matter.name).toBe('data.csv')
    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${existingId}`)
    expect(rows[0].status).toBe(ObjectStatus.TRASHED)
  })
})

// ─── confirmUpload ─────────────────────────────────────────────────────────────

describe('confirmUpload — name conflict', () => {
  it('throws NameConflictError when an active sibling was created during upload (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    // Simulate a draft created before another user created the same active name
    const draftId = await makeFile(db, orgId, 'collision.txt', { status: 'draft' })
    await makeFile(db, orgId, 'collision.txt') // active sibling added during upload window

    await expect(confirmUpload(db, draftId, orgId, { onConflict: 'fail' })).rejects.toThrow(NameConflictError)
  })

  it('renames the draft file when an active sibling was created during upload (rename)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const draftId = await makeFile(db, orgId, 'collision.txt', { status: 'draft' })
    await makeFile(db, orgId, 'collision.txt') // active sibling

    const { matter } = await confirmUpload(db, draftId, orgId, { onConflict: 'rename' })
    expect(matter).not.toBeNull()
    expect(matter?.name).toBe('collision (1).txt')
    expect(matter?.status).toBe('active')
  })
})

// ─── updateMatter (rename / move) ─────────────────────────────────────────────

describe('updateMatter — name conflict on rename', () => {
  it('throws NameConflictError when renaming to an existing name (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'a.txt')
    await makeFile(db, orgId, 'b.txt')

    await expect(updateMatter(db, id, orgId, { name: 'b.txt' })).rejects.toThrow(NameConflictError)
  })

  it('auto-renames when onConflict: rename during rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'a.txt')
    await makeFile(db, orgId, 'b.txt')

    const result = await updateMatter(db, id, orgId, { name: 'b.txt', onConflict: 'rename' })
    expect(result?.name).toBe('b (1).txt')
  })

  it('replaces existing file when onConflict: replace during rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'a.txt')
    const targetId = await makeFile(db, orgId, 'b.txt')

    const result = await updateMatter(db, id, orgId, { name: 'b.txt', onConflict: 'replace' })
    expect(result?.name).toBe('b.txt')
    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${targetId}`)
    expect(rows[0].status).toBe(ObjectStatus.TRASHED)
  })

  it('allows rename-in-place (A → A) without conflict even with fail strategy', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'same.txt')

    const result = await updateMatter(db, id, orgId, { name: 'same.txt', onConflict: 'fail' })
    expect(result?.name).toBe('same.txt')
  })
})

describe('updateMatter — name conflict on move', () => {
  it('throws NameConflictError when moving a file into a folder that already has same-named item', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'file.txt')
    await makeFolder(db, orgId, 'Dest')
    await makeFile(db, orgId, 'file.txt', { parent: 'Dest' })

    await expect(updateMatter(db, id, orgId, { parent: 'Dest' })).rejects.toThrow(NameConflictError)
  })

  it('auto-renames on move when onConflict: rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'file.txt')
    await makeFile(db, orgId, 'file.txt', { parent: 'Dest' })

    const result = await updateMatter(db, id, orgId, { parent: 'Dest', onConflict: 'rename' })
    expect(result?.name).toBe('file (1).txt')
    expect(result?.parent).toBe('Dest')
  })
})

// ─── batchMove ─────────────────────────────────────────────────────────────────

describe('batchMove — name conflict', () => {
  it('throws NameConflictError when moving into a parent with a name collision (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'report.txt')
    await makeFile(db, orgId, 'report.txt', { parent: 'Dest' })

    await expect(batchMove(db, orgId, [id], 'Dest', undefined, 'fail')).rejects.toThrow(NameConflictError)
  })

  it('renames per-item when onConflict: rename during batchMove', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'report.txt')
    await makeFile(db, orgId, 'report.txt', { parent: 'Dest' })

    const results = await batchMove(db, orgId, [id], 'Dest', undefined, 'rename')
    expect(results[0].name).toBe('report (1).txt')
    expect(results[0].parent).toBe('Dest')
  })

  it('does not apply conflict resolution for in-place moves (same parent)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'file.txt', { parent: 'SameFolder' })

    // Moving to the same parent should not trigger conflict even if fail strategy
    const results = await batchMove(db, orgId, [id], 'SameFolder', undefined, 'fail')
    expect(results[0].name).toBe('file.txt')
    expect(results[0].parent).toBe('SameFolder')
  })
})

// ─── copyMatter ───────────────────────────────────────────────────────────────

describe('copyMatter — name conflict', () => {
  it('defaults to rename when copying into a parent that already has the same name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const source = await createMatter(db, {
      orgId,
      name: 'doc.txt',
      type: 'text/plain',
      object: 'orig/key',
      storageId: STORAGE_ID,
      status: 'active',
    })
    // Another file with same name in target parent
    await makeFile(db, orgId, 'doc.txt', { parent: 'Target' })

    const copy = await copyMatter(db, source, 'Target', 'copy/key')
    expect(copy.name).toBe('doc (1).txt')
    expect(copy.parent).toBe('Target')
  })

  it('returns original name when target parent has no conflict', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const source = await createMatter(db, {
      orgId,
      name: 'doc.txt',
      type: 'text/plain',
      object: 'orig/key',
      storageId: STORAGE_ID,
      status: 'active',
    })

    const copy = await copyMatter(db, source, 'EmptyFolder', 'copy/key')
    expect(copy.name).toBe('doc.txt')
  })

  it('throws NameConflictError when onConflict: fail and target already has same name', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const source = await createMatter(db, {
      orgId,
      name: 'doc.txt',
      type: 'text/plain',
      object: 'orig/key',
      storageId: STORAGE_ID,
      status: 'active',
    })
    await makeFile(db, orgId, 'doc.txt', { parent: 'Target' })

    await expect(copyMatter(db, source, 'Target', 'copy/key', { onConflict: 'fail' })).rejects.toThrow(
      NameConflictError,
    )
  })
})

// ─── restoreMatter ────────────────────────────────────────────────────────────

describe('restoreMatter — name conflict', () => {
  it('throws NameConflictError when restoring to a parent where same name is already active (default fail)', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const trashedId = await makeFile(db, orgId, 'note.txt', { status: 'trashed' })
    await makeFile(db, orgId, 'note.txt') // active sibling created while original was in trash

    await expect(restoreMatter(db, orgId, trashedId)).rejects.toThrow(NameConflictError)
  })

  it('restores with an auto-renamed name when onConflict: rename', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const trashedId = await makeFile(db, orgId, 'note.txt', { status: 'trashed' })
    await makeFile(db, orgId, 'note.txt') // active sibling

    const result = await restoreMatter(db, orgId, trashedId, undefined, 'rename')
    expect(result?.name).toBe('note (1).txt')
    expect(result?.status).toBe(ObjectStatus.ACTIVE)
  })

  it('restores without conflict when original name is still free', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const trashedId = await makeFile(db, orgId, 'safe.txt', { status: 'trashed' })

    const result = await restoreMatter(db, orgId, trashedId)
    expect(result?.name).toBe('safe.txt')
    expect(result?.status).toBe(ObjectStatus.ACTIVE)
  })

  it('returns the item unchanged when it is not trashed', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    const id = await makeFile(db, orgId, 'active.txt')

    const result = await restoreMatter(db, orgId, id)
    expect(result?.status).toBe(ObjectStatus.ACTIVE)
    expect(result?.name).toBe('active.txt')
  })

  it('returns null for missing id', async () => {
    const { db } = await createTestApp()
    const result = await restoreMatter(db, 'org-x', 'nonexistent')
    expect(result).toBeNull()
  })
})

// ─── case-insensitive conflict across service calls ───────────────────────────

describe('case-insensitive name conflict across service layer', () => {
  it('createMatter with onConflict: fail rejects incoming "README.MD" when "readme.md" is active', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    await makeFile(db, orgId, 'readme.md')

    await expect(
      createMatter(db, {
        orgId,
        name: 'README.MD',
        type: 'text/markdown',
        object: 'key.md',
        storageId: STORAGE_ID,
        status: 'active',
      }),
    ).rejects.toThrow(NameConflictError)
  })

  it('updateMatter rename rejects "Report.PDF" when "report.pdf" is active in same folder', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()
    const id = await makeFile(db, orgId, 'other.txt')
    await makeFile(db, orgId, 'report.pdf')

    await expect(updateMatter(db, id, orgId, { name: 'Report.PDF' })).rejects.toThrow(NameConflictError)
  })
})

// ─── confirmUpload quota-then-replace atomicity ───────────────────────────────

describe('confirmUpload — quota-then-replace atomicity', () => {
  it('returns quotaExceeded and leaves incumbent active when quota is too tight', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    // Insert a tight quota that allows zero growth
    const quotaId = nanoid()
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used)
      VALUES (${quotaId}, ${orgId}, 100, 100)
    `)

    // Incumbent active file that 'replace' would trash
    const incumbentId = await makeFile(db, orgId, 'report.txt')

    // Draft file (size > 0 so quota check fires) with same name
    const draftId = nanoid()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES (${draftId}, ${orgId}, ${`${draftId}-alias`}, 'report.txt', 'text/plain', 50, 0, '', 'key.txt', ${STORAGE_ID}, 'draft', ${now}, ${now})
    `)

    const result = await confirmUpload(db, draftId, orgId, { onConflict: 'replace' })

    expect(result.quotaExceeded).toBe(true)
    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = ${incumbentId}`)
    expect(rows[0].status).toBe(ObjectStatus.ACTIVE)
  })
})

// ─── restoreMatter rename-before-activate ordering ───────────────────────────

describe('restoreMatter — rename-before-activate ordering', () => {
  it('cascades updated parent path to descendants before activation', async () => {
    const { db } = await createTestApp()
    await insertStorage(db)
    const orgId = nanoid()

    // Trashed folder "A" with a trashed child
    const folderId = nanoid()
    const folderNow = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
      VALUES (${folderId}, ${orgId}, ${`${folderId}-alias`}, 'A', 'folder', 0, 1, '', '', ${STORAGE_ID}, 'trashed', ${folderNow}, ${folderNow}, ${folderNow})
    `)

    const childId = nanoid()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
      VALUES (${childId}, ${orgId}, ${`${childId}-alias`}, 'child.txt', 'text/plain', 0, 0, 'A', 'child.txt', ${STORAGE_ID}, 'trashed', ${folderNow}, ${folderNow}, ${folderNow})
    `)

    // Active folder also named "A" — restore will rename the trashed one to "A (1)"
    await makeFolder(db, orgId, 'A')

    const result = await restoreMatter(db, orgId, folderId, undefined, 'rename')

    expect(result?.name).toBe('A (1)')
    expect(result?.status).toBe(ObjectStatus.ACTIVE)

    // Descendant must have the updated parent path and be active
    const childRows = await db.all<{ parent: string; status: string }>(
      sql`SELECT parent, status FROM matters WHERE id = ${childId}`,
    )
    expect(childRows[0].parent).toBe('A (1)')
    expect(childRows[0].status).toBe(ObjectStatus.ACTIVE)
  })
})
