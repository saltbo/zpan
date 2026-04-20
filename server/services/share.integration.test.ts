import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { DirType } from '../../shared/constants'
import { matters } from '../db/schema'
import { createTestApp } from '../test/setup.js'
import {
  cascadeDeleteByMatter,
  createShare,
  incrementDownloadsAtomic,
  incrementViews,
  isAccessibleByUser,
  listShareRecipientUserIds,
  listSharesByCreator,
  resolveShareByToken,
  revokeShare,
  verifyPassword,
} from './share.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function seedMatter(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: { orgId: string; storageId?: string; dirtype?: number; status?: string },
) {
  const now = new Date()
  const matter = {
    id: nanoid(),
    orgId: opts.orgId,
    alias: nanoid(10),
    name: `test-${nanoid(6)}`,
    type: opts.dirtype !== DirType.FILE ? 'folder' : 'application/pdf',
    size: 0,
    dirtype: opts.dirtype ?? DirType.FILE,
    parent: '',
    object: opts.dirtype !== DirType.FILE ? '' : `objects/${nanoid()}`,
    storageId: opts.storageId ?? 'storage-1',
    status: opts.status ?? 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(matters).values(matter)
  return matter
}

// ─── createShare ─────────────────────────────────────────────────────────────

describe('createShare', () => {
  it('creates a landing share for a file with password and recipients', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'user-1',
      kind: 'landing',
      password: 'secret123',
      recipients: [{ recipientEmail: 'alice@example.com' }],
    })

    expect(share.id).toBeTruthy()
    expect(share.token).toHaveLength(10)
    expect(share.kind).toBe('landing')
    expect(share.status).toBe('active')
    expect(share.passwordHash).toBeTruthy()
    expect(share.passwordHash).not.toBe('secret123')
  })

  it('creates a direct share for a file with no password and no recipients', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'user-1',
      kind: 'direct',
    })

    expect(share.kind).toBe('direct')
    expect(share.passwordHash).toBeNull()
  })

  it('throws DIRECT_NO_PASSWORD when direct share has a password', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    await expect(
      createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'direct', password: 'oops' }),
    ).rejects.toThrow('DIRECT_NO_PASSWORD')
  })

  it('throws DIRECT_NO_RECIPIENTS when direct share has recipients', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    await expect(
      createShare(db, {
        matterId: matter.id,
        orgId,
        creatorId: 'u1',
        kind: 'direct',
        recipients: [{ recipientEmail: 'bob@example.com' }],
      }),
    ).rejects.toThrow('DIRECT_NO_RECIPIENTS')
  })

  it('throws DIRECT_NO_FOLDER when direct share targets a folder', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const folder = await seedMatter(db, { orgId, dirtype: DirType.USER_FOLDER })

    await expect(createShare(db, { matterId: folder.id, orgId, creatorId: 'u1', kind: 'direct' })).rejects.toThrow(
      'DIRECT_NO_FOLDER',
    )
  })

  it('throws MATTER_NOT_FOUND when matter does not exist', async () => {
    const { db } = await createTestApp()

    await expect(
      createShare(db, { matterId: 'nonexistent', orgId: 'org-1', creatorId: 'u1', kind: 'landing' }),
    ).rejects.toThrow('MATTER_NOT_FOUND')
  })

  it('throws MATTER_NOT_FOUND when matter belongs to a different org', async () => {
    const { db } = await createTestApp()
    const matter = await seedMatter(db, { orgId: 'org-a' })

    await expect(
      createShare(db, { matterId: matter.id, orgId: 'org-b', creatorId: 'u1', kind: 'landing' }),
    ).rejects.toThrow('MATTER_NOT_FOUND')
  })

  it('sets downloadLimit and expiresAt when provided', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const expiresAt = new Date(Date.now() + 86400000)

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      downloadLimit: 5,
      expiresAt,
    })

    expect(share.downloadLimit).toBe(5)
    expect(share.expiresAt).toEqual(expiresAt)
  })
})

// ─── resolveShareByToken ──────────────────────────────────────────────────────

describe('resolveShareByToken', () => {
  it('returns full data including matter and recipients when found', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      recipients: [{ recipientUserId: 'user-42' }],
    })

    const resolved = await resolveShareByToken(db, share.token)
    expect(resolved.status === 'ok').toBe(true)
    if (resolved.status !== 'ok') throw new Error('expected found')
    expect(resolved.share.id).toBe(share.id)
    expect(resolved.matter.id).toBe(matter.id)
    expect(resolved.recipients).toHaveLength(1)
    expect(resolved.recipients[0].recipientUserId).toBe('user-42')
  })

  it('returns not_found when token does not exist', async () => {
    const { db } = await createTestApp()
    const resolved = await resolveShareByToken(db, 'nonexistent')
    expect(resolved.status === 'ok').toBe(false)
    if (resolved.status === 'ok') throw new Error('expected not found')
    expect(resolved.status).toBe('not_found')
  })

  it('returns revoked when share status is revoked', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    await revokeShare(db, share.id, 'u1')
    const resolved = await resolveShareByToken(db, share.token)
    expect(resolved.status === 'ok').toBe(false)
    if (resolved.status === 'ok') throw new Error('expected not found')
    expect(resolved.status).toBe('revoked')
  })

  it('returns trashed when underlying matter is trashed', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId, status: 'trashed' })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    const resolved = await resolveShareByToken(db, share.token)
    expect(resolved.status === 'ok').toBe(false)
    if (resolved.status === 'ok') throw new Error('expected not found')
    expect(resolved.status).toBe('matter_trashed')
  })

  it('returns found again after matter is restored from trash', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId, status: 'active' })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    // Trash it
    await db.update(matters).set({ status: 'trashed' }).where(eq(matters.id, matter.id))
    expect((await resolveShareByToken(db, share.token)).status).toBe('matter_trashed')

    // Restore it
    await db.update(matters).set({ status: 'active' }).where(eq(matters.id, matter.id))
    const resolved = await resolveShareByToken(db, share.token)
    expect(resolved.status === 'ok').toBe(true)
    if (resolved.status !== 'ok') throw new Error('expected found')
    expect(resolved.share.id).toBe(share.id)
  })
})

// ─── verifyPassword ───────────────────────────────────────────────────────────

describe('verifyPassword', () => {
  it('returns true for the correct password', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      password: 'correct-password',
    })

    expect(verifyPassword(share, 'correct-password')).toBe(true)
  })

  it('returns false for the wrong password', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      password: 'correct-password',
    })

    expect(verifyPassword(share, 'wrong-password')).toBe(false)
  })

  it('returns false when share has no password hash', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    expect(verifyPassword(share, 'any-password')).toBe(false)
  })
})

// ─── isAccessibleByUser ───────────────────────────────────────────────────────

describe('isAccessibleByUser', () => {
  it('returns true when userId is in recipients', () => {
    const now = new Date()
    const recipients = [{ id: '1', shareId: 's1', recipientUserId: 'user-42', recipientEmail: null, createdAt: now }]
    expect(isAccessibleByUser(recipients, 'user-42')).toBe(true)
  })

  it('returns false when userId is not in recipients', () => {
    const now = new Date()
    const recipients = [{ id: '1', shareId: 's1', recipientUserId: 'user-99', recipientEmail: null, createdAt: now }]
    expect(isAccessibleByUser(recipients, 'user-42')).toBe(false)
  })

  it('returns false for empty recipients list', () => {
    expect(isAccessibleByUser([], 'user-42')).toBe(false)
  })
})

// ─── incrementViews ───────────────────────────────────────────────────────────

describe('incrementViews', () => {
  it('increments view count correctly', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    await incrementViews(db, share.id)
    await incrementViews(db, share.id)

    const resolved = await resolveShareByToken(db, share.token)
    if (resolved.status !== 'ok') throw new Error('expected found')
    expect(resolved.share.views).toBe(2)
  })
})

// ─── incrementDownloadsAtomic ─────────────────────────────────────────────────

describe('incrementDownloadsAtomic', () => {
  it('returns ok=true and incremented count on success', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      downloadLimit: 10,
    })

    const result = await incrementDownloadsAtomic(db, share.id)
    expect(result.ok).toBe(true)
    expect(result.downloads).toBe(1)
  })

  it('enforces download limit — exactly limit calls succeed with concurrent calls', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      downloadLimit: 10,
    })

    const results = await Promise.all(Array.from({ length: 50 }, () => incrementDownloadsAtomic(db, share.id)))
    const successCount = results.filter((r) => r.ok).length
    expect(successCount).toBe(10)
  })

  it('returns ok=false when share is revoked', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })
    await revokeShare(db, share.id, 'u1')

    const result = await incrementDownloadsAtomic(db, share.id)
    expect(result.ok).toBe(false)
  })

  it('returns ok=false when share is expired', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const pastDate = new Date(Date.now() - 1000)
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      expiresAt: pastDate,
    })

    const result = await incrementDownloadsAtomic(db, share.id)
    expect(result.ok).toBe(false)
  })

  it('allows unlimited downloads when downloadLimit is null', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    const results = await Promise.all(Array.from({ length: 5 }, () => incrementDownloadsAtomic(db, share.id)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results[4].downloads).toBe(5)
  })
})

// ─── listSharesByCreator ──────────────────────────────────────────────────────

describe('listSharesByCreator', () => {
  it('returns empty result when no shares exist for creator', async () => {
    const { db } = await createTestApp()
    const result = await listSharesByCreator(db, 'unknown-creator', { page: 1, pageSize: 20 })
    expect(result).toEqual({ items: [], total: 0 })
  })

  it('returns shares with matterName and matterType joined', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    const result = await listSharesByCreator(db, 'u1', { page: 1, pageSize: 20 })
    expect(result.total).toBe(1)
    expect(result.items[0].matterName).toBe(matter.name)
    expect(result.items[0].matterType).toBe(matter.type)
  })

  it('paginates correctly', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    for (let i = 0; i < 5; i++) {
      const m = await seedMatter(db, { orgId })
      await createShare(db, { matterId: m.id, orgId, creatorId: 'paginator', kind: 'landing' })
    }

    const page1 = await listSharesByCreator(db, 'paginator', { page: 1, pageSize: 3 })
    expect(page1.total).toBe(5)
    expect(page1.items).toHaveLength(3)

    const page2 = await listSharesByCreator(db, 'paginator', { page: 2, pageSize: 3 })
    expect(page2.items).toHaveLength(2)
  })

  it('returns shares across multiple orgs for the same creator', async () => {
    const { db } = await createTestApp()
    const m1 = await seedMatter(db, { orgId: 'org-x' })
    const m2 = await seedMatter(db, { orgId: 'org-y' })
    await createShare(db, { matterId: m1.id, orgId: 'org-x', creatorId: 'cross-org-user', kind: 'landing' })
    await createShare(db, { matterId: m2.id, orgId: 'org-y', creatorId: 'cross-org-user', kind: 'landing' })

    const result = await listSharesByCreator(db, 'cross-org-user', { page: 1, pageSize: 20 })
    expect(result.total).toBe(2)
  })

  it('filters by status when provided', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const m1 = await seedMatter(db, { orgId })
    const m2 = await seedMatter(db, { orgId })
    await createShare(db, { matterId: m1.id, orgId, creatorId: 'u-filter', kind: 'landing' })
    const s2 = await createShare(db, { matterId: m2.id, orgId, creatorId: 'u-filter', kind: 'landing' })
    await revokeShare(db, s2.id, 'u-filter')

    const active = await listSharesByCreator(db, 'u-filter', { page: 1, pageSize: 20, status: 'active' })
    expect(active.total).toBe(1)

    const revoked = await listSharesByCreator(db, 'u-filter', { page: 1, pageSize: 20, status: 'revoked' })
    expect(revoked.total).toBe(1)
  })
})

// ─── revokeShare ─────────────────────────────────────────────────────────────

describe('revokeShare', () => {
  it('flips share status to revoked', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    await revokeShare(db, share.id, 'u1')
    expect((await resolveShareByToken(db, share.token)).status).toBe('revoked')
  })

  it('throws when non-creator tries to revoke', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })

    await expect(revokeShare(db, share.id, 'other-user')).rejects.toThrow()
  })

  it('throws when share does not exist', async () => {
    const { db } = await createTestApp()
    await expect(revokeShare(db, 'nonexistent', 'u1')).rejects.toThrow()
  })
})

// ─── listShareRecipientUserIds ────────────────────────────────────────────────

describe('listShareRecipientUserIds', () => {
  it('returns user IDs from recipients', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      recipients: [{ recipientUserId: 'user-a' }, { recipientUserId: 'user-b' }, { recipientEmail: 'c@example.com' }],
    })

    const ids = await listShareRecipientUserIds(db, share.id)
    expect(ids.sort()).toEqual(['user-a', 'user-b'].sort())
  })

  it('returns empty array when no user recipients', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      recipients: [{ recipientEmail: 'email@example.com' }],
    })

    const ids = await listShareRecipientUserIds(db, share.id)
    expect(ids).toEqual([])
  })
})

// ─── cascadeDeleteByMatter ────────────────────────────────────────────────────

describe('cascadeDeleteByMatter', () => {
  it('removes all shares and recipients for a matter', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const share = await createShare(db, {
      matterId: matter.id,
      orgId,
      creatorId: 'u1',
      kind: 'landing',
      recipients: [{ recipientUserId: 'user-x' }],
    })

    await cascadeDeleteByMatter(db, matter.id)

    expect((await resolveShareByToken(db, share.token)).status).toBe('not_found')
    const userIds = await listShareRecipientUserIds(db, share.id)
    expect(userIds).toEqual([])
  })

  it('is a no-op when matter has no shares', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })

    await expect(cascadeDeleteByMatter(db, matter.id)).resolves.toBeUndefined()
  })

  it('removes multiple shares for the same matter', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const matter = await seedMatter(db, { orgId })
    const s1 = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u1', kind: 'landing' })
    const s2 = await createShare(db, { matterId: matter.id, orgId, creatorId: 'u2', kind: 'landing' })

    await cascadeDeleteByMatter(db, matter.id)

    expect((await resolveShareByToken(db, s1.token)).status).toBe('not_found')
    expect((await resolveShareByToken(db, s2.token)).status).toBe('not_found')
  })
})
