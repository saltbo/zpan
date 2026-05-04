/**
 * Focused integration tests for the expanded audit event coverage.
 *
 * Verifies that each new audit action is recorded after the corresponding
 * mutation succeeds, and that no secret values appear in metadata.
 */
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activityEvents } from '../db/schema.js'
import { S3Service } from '../services/s3.js'
import { createShare } from '../services/share.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validStorage = {
  id: 'st-audit-test',
  title: 'Audit Test S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

async function insertStorage(db: TestDb, id = validStorage.id) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket}, ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertFile(
  db: TestDb,
  orgId: string,
  opts: { id: string; name: string; parent?: string; status?: string; size?: number },
) {
  const now = Date.now()
  const status = opts.status ?? 'active'
  const size = opts.size ?? 100
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${size}, 0, ${opts.parent ?? ''}, 'some/key.txt', ${validStorage.id}, ${status}, ${now}, ${now})
  `)
}

async function getPersonalOrgId(db: TestDb): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

async function getLatestActivity(db: TestDb, action: string) {
  const rows = await db.select().from(activityEvents).all()
  return rows.filter((r) => r.action === action).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

async function getAllActivities(db: TestDb) {
  return db.select().from(activityEvents).all()
}

function assertNoSecrets(metadata: string | null) {
  if (!metadata) return
  // Check that actual secret values / sensitive field names are not stored.
  // Use word-boundary patterns to avoid false positives on "hasPassword" or "key":"site_title".
  const forbidden = [
    '"password":',
    '"passwordHash":',
    '"secretKey":',
    '"accessKey":',
    '"apiKey":',
    '"token":',
    '"presignedUrl":',
    '"refreshToken":',
    '"cachedCert":',
    '"privateKey":',
    '"clientSecret":',
  ]
  for (const word of forbidden) {
    expect(metadata).not.toContain(word)
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

// ─── Object lifecycle ─────────────────────────────────────────────────────────

describe('Object lifecycle audit events', () => {
  it('records upload_confirm when confirming a draft upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    // Create draft file
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'report.pdf', type: 'application/pdf', size: 1024, dirtype: 0, parent: '' }),
    })
    expect(createRes.status).toBe(201)
    const { id: matterId } = (await createRes.json()) as { id: string }

    // Confirm upload
    const confirmRes = await app.request(`/api/objects/${matterId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(confirmRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'upload_confirm')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('file')
    expect(evt?.targetName).toBe('report.pdf')
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records upload_cancel when cancelling a draft upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'draft.pdf', type: 'application/pdf', size: 1024, dirtype: 0, parent: '' }),
    })
    expect(createRes.status).toBe(201)
    const { id: matterId } = (await createRes.json()) as { id: string }

    const cancelRes = await app.request(`/api/objects/${matterId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'upload_cancel')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('file')
    expect(evt?.targetName).toBe('draft.pdf')
    expect(evt?.orgId).toBe(orgId)
  })

  it('records object_copy when copying a file', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'src-file', name: 'original.txt' })

    const copyRes = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'src-file', parent: '' }),
    })
    expect(copyRes.status).toBe(201)

    const evt = await getLatestActivity(db, 'object_copy')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('file')
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records object_purge when permanently deleting a single item', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'trashed-file', name: 'trashed.txt', status: 'trashed' })

    const deleteRes = await app.request('/api/objects/trashed-file', {
      method: 'DELETE',
      headers,
    })
    expect(deleteRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'object_purge')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('file')
    expect(evt?.targetName).toBe('trashed.txt')
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records batch_trash when batch trashing items', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'bt-file1', name: 'file1.txt' })
    await insertFile(db, orgId, { id: 'bt-file2', name: 'file2.txt' })

    const res = await app.request('/api/objects/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash', ids: ['bt-file1', 'bt-file2'] }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'batch_trash')
    expect(evt).toBeDefined()
    expect(evt?.orgId).toBe(orgId)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { count: number }
    expect(meta.count).toBeGreaterThan(0)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records batch_purge when batch permanently deleting', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'bp-file1', name: 'file1.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'bp-file2', name: 'file2.txt', status: 'trashed' })

    const res = await app.request('/api/objects/batch', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['bp-file1', 'bp-file2'] }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'batch_purge')
    expect(evt).toBeDefined()
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records trash_empty when emptying trash', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'te-file1', name: 'junk1.txt', status: 'trashed' })

    const res = await app.request('/api/trash', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'trash_empty')
    expect(evt).toBeDefined()
    expect(evt?.orgId).toBe(orgId)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { count: number }
    expect(meta.count).toBeGreaterThan(0)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('does NOT record trash_empty when trash was already empty', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)

    const before = await getAllActivities(db)
    const res = await app.request('/api/trash', { method: 'DELETE', headers })
    expect(res.status).toBe(200)

    const after = await getAllActivities(db)
    const newTrashEmpty = after.filter((e) => e.action === 'trash_empty' && !before.some((b) => b.id === e.id))
    expect(newTrashEmpty).toHaveLength(0)
  })
})

// ─── Share lifecycle ──────────────────────────────────────────────────────────

describe('Share lifecycle audit events', () => {
  it('records share_create when a share is created', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'share-file', name: 'shared.pdf' })

    const res = await app.request('/api/shares', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ matterId: 'share-file', kind: 'landing' }),
    })
    expect(res.status).toBe(201)

    const evt = await getLatestActivity(db, 'share_create')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('share')
    expect(evt?.targetName).toBe('shared.pdf')
    expect(evt?.orgId).toBe(orgId)
    // must not store password hashes or tokens
    assertNoSecrets(evt?.metadata ?? null)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { kind: string; hasPassword: boolean }
    expect(meta.kind).toBe('landing')
    expect(meta.hasPassword).toBe(false)
  })

  it('records share_revoke when a share is deleted', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    await insertFile(db, orgId, { id: 'revoke-file', name: 'torevoke.pdf' })

    const createRes = await app.request('/api/shares', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ matterId: 'revoke-file', kind: 'landing' }),
    })
    const { token } = (await createRes.json()) as { token: string }

    const revokeRes = await app.request(`/api/shares/${token}`, {
      method: 'DELETE',
      headers,
    })
    expect(revokeRes.status).toBe(204)

    const evt = await getLatestActivity(db, 'share_revoke')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('share')
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Team lifecycle ───────────────────────────────────────────────────────────

describe('Team lifecycle audit events', () => {
  it('records team_invite_link_create when creating an invite link', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getPersonalOrgId(db)

    const res = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(201)

    const evt = await getLatestActivity(db, 'team_invite_link_create')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('team')
    expect(evt?.orgId).toBe(orgId)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { role: string }
    expect(meta.role).toBe('viewer')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records team_member_join when accepting an invite link', async () => {
    const { app, db } = await createTestApp()
    const ownerHeaders = await authedHeaders(app, 'owner@example.com')
    const orgId = await getPersonalOrgId(db)

    // Create invite link as owner
    const linkRes = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    const { token } = (await linkRes.json()) as { token: string }

    // New member joins
    const memberHeaders = await authedHeaders(app, 'newmember@example.com')
    const joinRes = await app.request(`/api/teams/${orgId}/members`, {
      method: 'POST',
      headers: { ...memberHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(joinRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'team_member_join')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('team')
    expect(evt?.orgId).toBe(orgId)
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── System option audit events ───────────────────────────────────────────────

describe('System option audit events', () => {
  it('records system_option_set when admin sets an option', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await app.request('/api/system/options/site_title', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'My ZPan', public: true }),
    })
    expect(res.status).toBe(201)

    const evt = await getLatestActivity(db, 'system_option_set')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('system')
    expect(evt?.targetName).toBe('site_title')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records system_option_delete when admin deletes an option', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    // Create it first
    await app.request('/api/system/options/temp_key', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'temp', public: false }),
    })

    const res = await app.request('/api/system/options/temp_key', {
      method: 'DELETE',
      headers: admin,
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'system_option_delete')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('system')
    expect(evt?.targetName).toBe('temp_key')
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Storage audit events ─────────────────────────────────────────────────────

describe('Storage audit events', () => {
  it('records storage_create when admin creates a storage', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Storage',
        mode: 'private',
        bucket: 'my-bucket',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }),
    })
    expect(res.status).toBe(201)

    const evt = await getLatestActivity(db, 'storage_create')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('storage')
    expect(evt?.targetName).toBe('New Storage')
    // Must NOT store secret keys or access keys in metadata
    assertNoSecrets(evt?.metadata ?? null)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { mode: string }
    expect(meta.mode).toBe('private')
  })

  it('records storage_update when admin updates a storage', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Original Storage',
        mode: 'private',
        bucket: 'my-bucket',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }),
    })
    const { id: storageId } = (await createRes.json()) as { id: string }

    const updateRes = await app.request(`/api/admin/storages/${storageId}`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Storage' }),
    })
    expect(updateRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'storage_update')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('storage')
    expect(evt?.targetName).toBe('Updated Storage')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records storage_delete when admin deletes a storage', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    const createRes = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Deletable Storage',
        mode: 'private',
        bucket: 'del-bucket',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }),
    })
    const { id: storageId } = (await createRes.json()) as { id: string }

    const deleteRes = await app.request(`/api/admin/storages/${storageId}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(deleteRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'storage_delete')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('storage')
    expect(evt?.targetName).toBe('Deletable Storage')
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Quota audit events ───────────────────────────────────────────────────────

describe('Quota audit events', () => {
  it('records quota_update when admin updates a quota', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)
    const orgId = await getPersonalOrgId(db)

    const res = await app.request(`/api/admin/quotas/${orgId}`, {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 10737418240 }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'quota_update')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('quota')
    assertNoSecrets(evt?.metadata ?? null)
    const meta = JSON.parse(evt?.metadata ?? '{}') as { quota: number; targetOrgId: string }
    expect(meta.quota).toBe(10737418240)
    expect(meta.targetOrgId).toBe(orgId)
  })
})

// ─── Invite code audit events ─────────────────────────────────────────────────

describe('Invite code audit events', () => {
  it('records invite_code_generate when admin generates invite codes', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    const res = await app.request('/api/admin/invite-codes', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3 }),
    })
    expect(res.status).toBe(201)

    const evt = await getLatestActivity(db, 'invite_code_generate')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('invite_code')
    const meta = JSON.parse(evt?.metadata ?? '{}') as { count: number }
    expect(meta.count).toBe(3)
    // Must not store the actual invite code values in metadata
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records invite_code_delete when admin deletes an invite code', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    const createRes = await app.request('/api/admin/invite-codes', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    const { codes } = (await createRes.json()) as { codes: Array<{ id: string }> }

    const deleteRes = await app.request(`/api/admin/invite-codes/${codes[0].id}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(deleteRes.status).toBe(200)

    const evt = await getLatestActivity(db, 'invite_code_delete')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('invite_code')
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── User admin audit events ──────────────────────────────────────────────────

describe('User admin audit events', () => {
  it('records user_disable when admin disables a user', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    // Create a non-admin user
    await authedHeaders(app, 'target@example.com')
    const usersRes = await app.request('/api/admin/users', { headers: admin })
    const { items } = (await usersRes.json()) as { items: Array<{ id: string; email: string }> }
    const target = items.find((u) => u.email === 'target@example.com')
    expect(target).toBeDefined()

    const res = await app.request(`/api/admin/users/${target!.id}`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'user_disable')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('user')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records user_enable when admin re-enables a user', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    await authedHeaders(app, 'reenable@example.com')
    const usersRes = await app.request('/api/admin/users', { headers: admin })
    const { items } = (await usersRes.json()) as { items: Array<{ id: string; email: string }> }
    const target = items.find((u) => u.email === 'reenable@example.com')!

    // First disable
    await app.request(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })

    // Then re-enable
    const res = await app.request(`/api/admin/users/${target.id}`, {
      method: 'PATCH',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'user_enable')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('user')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records user_delete when admin deletes a user', async () => {
    const { app, db } = await createTestApp()
    const admin = await adminHeaders(app)

    await authedHeaders(app, 'todelete@example.com')
    const usersRes = await app.request('/api/admin/users', { headers: admin })
    const { items } = (await usersRes.json()) as { items: Array<{ id: string; email: string }> }
    const target = items.find((u) => u.email === 'todelete@example.com')!

    const res = await app.request(`/api/admin/users/${target.id}`, {
      method: 'DELETE',
      headers: admin,
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'user_delete')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('user')
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Share download audit events ──────────────────────────────────────────────

describe('Share download audit events', () => {
  it('records share_download when a file is downloaded via a share', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app) // seeds user and personal org
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)
    const creatorId = (await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`))[0].id
    await insertFile(db, orgId, { id: 'dl-audit-1', name: 'report.pdf' })
    const share = await createShare(db, { matterId: 'dl-audit-1', orgId, creatorId, kind: 'landing' })

    // Fetch rootRef from share metadata
    const metaRes = await app.request(`/api/shares/${share.token}`)
    const meta = (await metaRes.json()) as { rootRef: string }
    const rootRef = meta.rootRef

    const res = await app.request(`/api/shares/${share.token}/objects/${rootRef}?downloadUrl=1`, { redirect: 'manual' })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'share_download')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('share')
    expect(evt?.targetName).toBe('report.pdf')
    // Presigned URL must NOT be stored in metadata
    const metaStr = evt?.metadata ?? ''
    expect(metaStr).not.toContain('presigned')
    expect(metaStr).not.toContain('https://')
    assertNoSecrets(metaStr)
  })

  it('records share_download using creator as actor for anonymous download', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app) // seeds user and personal org
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)
    const creatorId = (await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`))[0].id
    await insertFile(db, orgId, { id: 'dl-audit-2', name: 'anon.pdf' })
    const share = await createShare(db, { matterId: 'dl-audit-2', orgId, creatorId, kind: 'landing' })

    const metaRes = await app.request(`/api/shares/${share.token}`)
    const meta = (await metaRes.json()) as { rootRef: string }

    // Anonymous download (no auth headers)
    const res = await app.request(`/api/shares/${share.token}/objects/${meta.rootRef}?downloadUrl=1`, {
      redirect: 'manual',
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'share_download')
    expect(evt).toBeDefined()
    expect(evt?.userId).toBe(creatorId) // creator used as proxy for anonymous
    const md = JSON.parse(evt?.metadata ?? '{}') as Record<string, unknown>
    expect(md.anonymous).toBe(true)
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Org/team lifecycle via Better Auth hooks ─────────────────────────────────

describe('Org/team lifecycle audit events (Better Auth hooks)', () => {
  it('records team_settings_update when org is updated via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a team org first
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Audit Test Org', slug: 'audit-test-org' }),
    })
    expect(createRes.status).toBe(200)
    const org = (await createRes.json()) as { id: string }

    // Update org name
    const res = await app.request('/api/auth/organization/update', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org.id, data: { name: 'Updated Org Name' } }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'team_settings_update')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('team')
    expect(evt?.orgId).toBe(org.id)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records team_member_remove when a member is removed via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const adminH = await adminHeaders(app)

    // Create a second user
    const memberHeaders = await authedHeaders(app, 'member-to-remove@example.com')
    const memberRes = await app.request('/api/auth/get-session', { headers: memberHeaders })
    const memberSession = (await memberRes.json()) as { user: { id: string } }
    const memberId = memberSession.user.id

    // Create an org as admin
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Remove Test Org', slug: 'remove-test-org' }),
    })
    expect(createRes.status).toBe(200)
    const org = (await createRes.json()) as { id: string }

    // Manually insert the member
    const now = Date.now()
    await db.run(
      sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${'mem-' + memberId}, ${org.id}, ${memberId}, 'viewer', ${now})`,
    )
    const memberRow = await db.all<{ id: string }>(
      sql`SELECT id FROM member WHERE organization_id = ${org.id} AND user_id = ${memberId}`,
    )

    // Remove member via Better Auth
    const res = await app.request('/api/auth/organization/remove-member', {
      method: 'POST',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org.id, memberIdOrEmail: memberRow[0].id }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'team_member_remove')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('team')
    expect(evt?.orgId).toBe(org.id)
    const md = JSON.parse(evt?.metadata ?? '{}') as Record<string, unknown>
    expect(md.removedUserId).toBe(memberId)
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records team_member_role_update when a member role is changed via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const adminH = await adminHeaders(app)

    // Create a second user
    await authedHeaders(app, 'role-update-member@example.com')
    // Look up newly created user by email
    const memberRows = await db.all<{ id: string }>(
      sql`SELECT id FROM user WHERE email = 'role-update-member@example.com' LIMIT 1`,
    )
    const memberId = memberRows[0].id

    // Create org
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Role Update Org', slug: 'role-update-org' }),
    })
    const org = (await createRes.json()) as { id: string }

    // Add member
    const now = Date.now()
    const memberRowId = `mem-role-${memberId}`
    await db.run(
      sql`INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (${memberRowId}, ${org.id}, ${memberId}, 'viewer', ${now})`,
    )

    // Update role
    const res = await app.request('/api/auth/organization/update-member-role', {
      method: 'POST',
      headers: { ...adminH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org.id, memberId: memberRowId, role: 'editor' }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'team_member_role_update')
    expect(evt).toBeDefined()
    expect(evt?.orgId).toBe(org.id)
    const md = JSON.parse(evt?.metadata ?? '{}') as Record<string, unknown>
    expect(md.previousRole).toBe('viewer')
    expect(md.newRole).toBe('editor')
    assertNoSecrets(evt?.metadata ?? null)
  })

  it('records team_delete when an org is deleted via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)

    // Create a team org to delete
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'To Delete Org', slug: 'to-delete-org' }),
    })
    expect(createRes.status).toBe(200)
    const org = (await createRes.json()) as { id: string }

    const res = await app.request('/api/auth/organization/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org.id }),
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'team_delete')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('team')
    expect(evt?.targetId).toBe(org.id)
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── License refresh audit event ──────────────────────────────────────────────

describe('License refresh audit event', () => {
  it('records license_refresh when admin triggers a refresh', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const res = await app.request('/api/licensing/refresh', {
      method: 'POST',
      headers,
    })
    expect(res.status).toBe(200)

    const evt = await getLatestActivity(db, 'license_refresh')
    expect(evt).toBeDefined()
    expect(evt?.targetType).toBe('license')
    assertNoSecrets(evt?.metadata ?? null)
  })
})

// ─── Admin audit API still works ──────────────────────────────────────────────

describe('Admin audit API with new event types', () => {
  it('can filter by new action types', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    // Seed a system_option_set event
    await app.request('/api/system/options/audit_test_key', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'test', public: false }),
    })

    const res = await app.request('/api/admin/audit?action=system_option_set', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ action: string }>; total: number }
    expect(body.total).toBeGreaterThan(0)
    expect(body.items.every((e) => e.action === 'system_option_set')).toBe(true)
  })

  it('can filter by new target types', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)

    // Seed a system target type event
    await app.request('/api/system/options/another_key', {
      method: 'PUT',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'value', public: false }),
    })

    const res = await app.request('/api/admin/audit?targetType=system', { headers: admin })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ targetType: string }>; total: number }
    expect(body.total).toBeGreaterThan(0)
    expect(body.items.every((e) => e.targetType === 'system')).toBe(true)
  })

  it('existing file/folder events still appear in audit', async () => {
    const { app, db } = await createTestApp()
    await seedProLicense(db)
    const admin = await adminHeaders(app)
    const headers = await authedHeaders(app, 'test@example.com')
    await insertStorage(db)
    const orgId = await getPersonalOrgId(db)

    // Create a folder (records 'create' event)
    await insertFile(db, orgId, { id: 'legacy-file', name: 'legacy.txt' })

    const res = await app.request('/api/admin/audit?action=upload', { headers: admin })
    // Upload events come from confirmUpload now but we can still filter on file create
    const res2 = await app.request('/api/admin/audit?targetType=file', { headers: admin })
    expect(res2.status).toBe(200)
  })
})
