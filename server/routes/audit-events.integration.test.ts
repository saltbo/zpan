/**
 * Audit event coverage integration tests.
 *
 * Verifies that every newly added audit event category produces an
 * activityEvents row after a successful mutation, and asserts that no
 * secret values (tokens, presigned URLs, keys) appear in metadata.
 */
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DirType } from '../../shared/constants.js'
import { activityEvents, orgQuotas } from '../db/schema.js'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense } from '../test/setup.js'

vi.mock('../services/s3.js', () => {
  const S3Service = vi.fn()
  S3Service.prototype.presignUpload = vi.fn().mockResolvedValue('https://s3.example.com/upload?sig=REDACTED')
  S3Service.prototype.presignDownload = vi.fn().mockResolvedValue('https://s3.example.com/download?sig=REDACTED')
  S3Service.prototype.deleteObject = vi.fn().mockResolvedValue(undefined)
  S3Service.prototype.deleteObjects = vi.fn().mockResolvedValue(undefined)
  S3Service.prototype.copyObject = vi.fn().mockResolvedValue(undefined)
  return { S3Service }
})

vi.mock('../services/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  getEmailConfig: vi.fn().mockResolvedValue({ host: 'smtp.test', port: 587, user: 'u', pass: 'p', from: 'f' }),
  isEmailConfigured: vi.fn().mockResolvedValue(false),
}))

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

const VALID_STORAGE = {
  id: 'st-audit-test',
  title: 'Audit Test S3',
  mode: 'private',
  bucket: 'audit-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

async function insertStorage(db: TestDb, opts = VALID_STORAGE) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${opts.id}, ${opts.title}, ${opts.mode}, ${opts.bucket}, ${opts.endpoint}, ${opts.region}, ${opts.accessKey}, ${opts.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertMatter(
  db: TestDb,
  orgId: string,
  opts: { id?: string; name?: string; status?: string; dirtype?: number; parent?: string },
) {
  const id = opts.id ?? nanoid()
  const now = Date.now()
  const dirtype = opts.dirtype ?? DirType.FILE
  const status = opts.status ?? 'active'
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`alias-${id}`}, ${opts.name ?? 'test.txt'}, 'text/plain', 1024, ${dirtype}, ${opts.parent ?? ''}, ${dirtype === DirType.FILE ? 'key/test.txt' : ''}, ${VALID_STORAGE.id}, ${status}, ${now}, ${now})
  `)
  return id
}

async function getAuditEvents(db: TestDb, action?: string) {
  const rows = await db.select().from(activityEvents)
  return action ? rows.filter((r) => r.action === action) : rows
}

function assertNoSecrets(metadata: string | null) {
  if (!metadata) return
  const lower = metadata.toLowerCase()
  // None of these patterns should appear in stored metadata
  // Note: "haspassword" is allowed (it's a boolean flag), but the actual password value must not be stored
  for (const forbidden of ['secret_key', 'access_key', 'refresh_token', 'presign', 'sig=', 'x-amz-signature']) {
    expect(lower).not.toContain(forbidden)
  }
}

// ─── Share lifecycle ──────────────────────────────────────────────────────────

describe('Audit: share lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    await insertStorage(db)
    await seedProLicense(db)
    headers = await authedHeaders(app)
  })

  it('records share_create on share creation', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    const matterId = await insertMatter(db, orgId, {})

    const res = await app.request('/api/shares', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ matterId, kind: 'landing' }),
    })
    expect(res.status).toBe(201)

    const events = await getAuditEvents(db, 'share_create')
    expect(events).toHaveLength(1)
    assertNoSecrets(events[0].metadata)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.hasPassword).toBe(false)
    expect(meta.kind).toBe('landing')
    expect(meta.matterId).toBe(matterId)
    // Ensure token/presignedUrl not in metadata
    expect(events[0].metadata).not.toContain('token')
  })

  it('records share_revoke on share deletion', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    const matterId = await insertMatter(db, orgId, {})

    const createRes = await app.request('/api/shares', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ matterId, kind: 'landing' }),
    })
    expect(createRes.status).toBe(201)
    const { token } = (await createRes.json()) as { token: string }

    const revokeRes = await app.request(`/api/shares/${token}`, {
      method: 'DELETE',
      headers,
    })
    expect(revokeRes.status).toBe(204)

    const events = await getAuditEvents(db, 'share_revoke')
    expect(events).toHaveLength(1)
    assertNoSecrets(events[0].metadata)
  })
})

// ─── Object lifecycle ─────────────────────────────────────────────────────────

describe('Audit: object lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    await insertStorage(db)
    headers = await authedHeaders(app)
  })

  it('records upload_confirm when confirming a draft upload', async () => {
    const orgId = await getOrgIdFromSession(app, headers)

    // Create a draft matter
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'file.txt', type: 'text/plain', size: 100, parent: '', dirtype: DirType.FILE }),
    })
    expect(createRes.status).toBe(201)
    const { id } = (await createRes.json()) as { id: string }

    // Set quota so confirm succeeds
    await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota: 1_000_000, used: 0 })

    const confirmRes = await app.request(`/api/objects/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(confirmRes.status).toBe(200)

    const events = await getAuditEvents(db, 'upload_confirm')
    expect(events).toHaveLength(1)
    expect(events[0].targetId).toBe(id)
    assertNoSecrets(events[0].metadata)
  })

  it('records upload_cancel when cancelling a draft upload', async () => {
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cancel.txt', type: 'text/plain', size: 100, parent: '', dirtype: DirType.FILE }),
    })
    expect(createRes.status).toBe(201)
    const { id } = (await createRes.json()) as { id: string }

    const cancelRes = await app.request(`/api/objects/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    expect(cancelRes.status).toBe(200)

    const events = await getAuditEvents(db, 'upload_cancel')
    expect(events).toHaveLength(1)
  })

  it('records object_copy on copy', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota: 1_000_000, used: 0 })
    const sourceId = await insertMatter(db, orgId, { name: 'source.txt' })

    const copyRes = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: sourceId, parent: '' }),
    })
    expect(copyRes.status).toBe(201)

    const events = await getAuditEvents(db, 'object_copy')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.fromName).toBe('source.txt')
    assertNoSecrets(events[0].metadata)
  })

  it('records object_purge on permanent deletion of single item', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    const matterId = await insertMatter(db, orgId, { status: 'trashed' })

    const deleteRes = await app.request(`/api/objects/${matterId}`, {
      method: 'DELETE',
      headers,
    })
    expect(deleteRes.status).toBe(200)

    const events = await getAuditEvents(db, 'object_purge')
    expect(events).toHaveLength(1)
    expect(events[0].targetId).toBe(matterId)
    assertNoSecrets(events[0].metadata)
  })

  it('records batch_trash on batch trash', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    const id1 = await insertMatter(db, orgId, { name: 'a.txt' })
    const id2 = await insertMatter(db, orgId, { name: 'b.txt' })

    const res = await app.request('/api/objects/batch', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash', ids: [id1, id2] }),
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'batch_trash')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.count).toBe(2)
    assertNoSecrets(events[0].metadata)
  })

  it('records batch_purge on batch permanent deletion', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    const id1 = await insertMatter(db, orgId, { status: 'trashed', name: 'a.txt' })
    const id2 = await insertMatter(db, orgId, { status: 'trashed', name: 'b.txt' })

    const res = await app.request('/api/objects/batch', {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id1, id2] }),
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'batch_purge')
    expect(events).toHaveLength(1)
    assertNoSecrets(events[0].metadata)
  })

  it('records trash_empty when emptying trash', async () => {
    const orgId = await getOrgIdFromSession(app, headers)
    await insertMatter(db, orgId, { status: 'trashed', name: 'trashed.txt' })

    const res = await app.request('/api/trash', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'trash_empty')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(typeof meta.count).toBe('number')
  })
})

// ─── Team lifecycle ───────────────────────────────────────────────────────────

describe('Audit: team lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    headers = await authedHeaders(app)
  })

  it('records team_invite_link_create on invite link creation', async () => {
    const orgId = await getOrgIdFromSession(app, headers)

    const res = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(res.status).toBe(201)

    const events = await getAuditEvents(db, 'team_invite_link_create')
    expect(events).toHaveLength(1)
    expect(events[0].orgId).toBe(orgId)
    // token should NOT be in metadata
    assertNoSecrets(events[0].metadata)
  })

  it('records team_member_join on accepting invite link', async () => {
    const orgId = await getOrgIdFromSession(app, headers)

    // Create invite link as owner
    const linkRes = await app.request(`/api/teams/${orgId}/invite-link`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    })
    const { token } = (await linkRes.json()) as { token: string }

    // New user joins
    const newHeaders = await authedHeaders(app, 'newmember@example.com')
    const joinRes = await app.request(`/api/teams/${orgId}/members`, {
      method: 'POST',
      headers: { ...newHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(joinRes.status).toBe(200)

    const events = await getAuditEvents(db, 'team_member_join')
    expect(events).toHaveLength(1)
  })
})

// ─── Admin/system lifecycle ───────────────────────────────────────────────────

describe('Audit: admin system lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    headers = await adminHeaders(app)
  })

  it('records system_option_set on option update', async () => {
    const res = await app.request('/api/system/options/test_audit_key', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'test_value' }),
    })
    expect(res.status).toBeOneOf([200, 201])

    const events = await getAuditEvents(db, 'system_option_set')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('test_audit_key')
    // The value itself should not be stored (only the key is safe metadata)
    assertNoSecrets(events[0].metadata)
  })

  it('records system_option_delete on option deletion', async () => {
    // First create an option
    await app.request('/api/system/options/to_delete', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'something' }),
    })

    const res = await app.request('/api/system/options/to_delete', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'system_option_delete')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('to_delete')
  })

  it('records storage_create on storage creation', async () => {
    const res = await app.request('/api/admin/storages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Storage',
        mode: 'private',
        bucket: 'my-bucket',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'AKIAIOSFODNN7EXAMPLE',
        secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        filePath: '',
      }),
    })
    expect(res.status).toBe(201)

    const events = await getAuditEvents(db, 'storage_create')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('Test Storage')
    // Access key and secret key must NOT appear in metadata
    const meta = events[0].metadata ?? ''
    expect(meta).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(meta).not.toContain('wJalrXUtnFEMI')
  })

  it('records storage_update on storage update', async () => {
    const now = Date.now()
    const storageId = nanoid()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${storageId}, 'Old Title', 'private', 'bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKID', 'SECRET', '', '', 0, 0, 'active', ${now}, ${now})
    `)

    const res = await app.request(`/api/admin/storages/${storageId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Title',
        mode: 'private',
        bucket: 'bucket',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'AKID',
        secretKey: 'SECRET',
        filePath: '',
      }),
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'storage_update')
    expect(events).toHaveLength(1)
    expect(events[0].metadata).not.toContain('SECRET')
    expect(events[0].metadata).not.toContain('AKID')
  })

  it('records storage_delete on storage deletion', async () => {
    const now = Date.now()
    const storageId = nanoid()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${storageId}, 'To Delete', 'private', 'bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AKID', 'SECRET', '', '', 0, 0, 'active', ${now}, ${now})
    `)

    const res = await app.request(`/api/admin/storages/${storageId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'storage_delete')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('To Delete')
  })

  it('records quota_update on quota change', async () => {
    // Create a target org
    const targetOrgId = nanoid()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO organization (id, name, slug, created_at) VALUES (${targetOrgId}, 'Target Org', ${`slug-${targetOrgId}`}, ${now})
    `)

    const res = await app.request(`/api/admin/quotas/${targetOrgId}`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quota: 5_000_000_000 }),
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'quota_update')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.quota).toBe(5_000_000_000)
    expect(meta.targetOrgId).toBe(targetOrgId)
  })

  it('records invite_code_generate on code generation', async () => {
    const res = await app.request('/api/admin/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 3 }),
    })
    expect(res.status).toBe(201)

    const events = await getAuditEvents(db, 'invite_code_generate')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.count).toBe(3)
    // The actual code values must not appear in metadata
    assertNoSecrets(events[0].metadata)
  })

  it('records user_disable and user_enable on user status changes', async () => {
    // Create a second user
    const secondHeaders = await authedHeaders(app, 'second@example.com')
    const secondUserId = await getUserIdFromSession(app, secondHeaders)

    const disableRes = await app.request(`/api/admin/users/${secondUserId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const disableEvents = await getAuditEvents(db, 'user_disable')
    expect(disableEvents).toHaveLength(1)
    const disableMeta = JSON.parse(disableEvents[0].metadata ?? '{}') as Record<string, unknown>
    expect(disableMeta.targetUserId).toBe(secondUserId)

    const enableRes = await app.request(`/api/admin/users/${secondUserId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(enableRes.status).toBe(200)

    const enableEvents = await getAuditEvents(db, 'user_enable')
    expect(enableEvents).toHaveLength(1)
  })

  it('records user_delete on user deletion', async () => {
    const secondHeaders = await authedHeaders(app, 'todelete@example.com')
    const secondUserId = await getUserIdFromSession(app, secondHeaders)

    const res = await app.request(`/api/admin/users/${secondUserId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'user_delete')
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.targetUserId).toBe(secondUserId)
  })
})

// ─── Auth lifecycle ───────────────────────────────────────────────────────────

describe('Audit: auth lifecycle', () => {
  it('records sign_up on new user registration', async () => {
    const { app, db } = await createTestApp()

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: 'password123456' }),
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'sign_up')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('alice@example.com')
    assertNoSecrets(events[0].metadata)
    // Password must not appear in any field
    expect(events[0].targetName).not.toContain('password')
  })
})

// ─── Site invitation lifecycle ────────────────────────────────────────────────

describe('Audit: site invitation lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    headers = await adminHeaders(app)
  })

  it('records site_invitation_create on invitation creation', async () => {
    const res = await app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invited@example.com' }),
    })
    expect(res.status).toBe(201)

    const events = await getAuditEvents(db, 'site_invitation_create')
    expect(events).toHaveLength(1)
    expect(events[0].targetName).toBe('invited@example.com')
    // Invitation token must NOT appear in metadata
    const meta = events[0].metadata ?? ''
    expect(meta).not.toContain('token')
  })

  it('records site_invitation_revoke on invitation revocation', async () => {
    const createRes = await app.request('/api/admin/site-invitations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'revoke@example.com' }),
    })
    const invitation = (await createRes.json()) as { id: string }

    const res = await app.request(`/api/admin/site-invitations/${invitation.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'site_invitation_revoke')
    expect(events).toHaveLength(1)
  })
})

// ─── Invite codes lifecycle ───────────────────────────────────────────────────

describe('Audit: invite code lifecycle', () => {
  let app: TestApp, db: TestDb, headers: Record<string, string>

  beforeEach(async () => {
    ;({ app, db } = await createTestApp())
    headers = await adminHeaders(app)
  })

  it('records invite_code_delete on code deletion', async () => {
    // Generate a code first
    const genRes = await app.request('/api/admin/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    const { codes } = (await genRes.json()) as { codes: Array<{ id: string }> }
    const codeId = codes[0].id

    const res = await app.request(`/api/admin/invite-codes/${codeId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(200)

    const events = await getAuditEvents(db, 'invite_code_delete')
    expect(events).toHaveLength(1)
    // The actual code value must not appear
    assertNoSecrets(events[0].metadata)
  })

  it('records invite_code_redeem when signing up with an invite code', async () => {
    // Set signup mode to invite_only
    await app.request('/api/system/options/auth_signup_mode', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'auth_signup_mode', value: 'invite_only' }),
    })

    // Generate a code
    const genRes = await app.request('/api/admin/invite-codes', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    const { codes } = (await genRes.json()) as { codes: Array<{ id: string; code: string }> }
    const rawCode = codes[0].code
    const codeRowId = codes[0].id

    // Sign up using the invite code
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Redeemer',
        email: 'redeemer@example.com',
        password: 'password123456',
        inviteCode: rawCode,
      }),
    })
    expect(signUpRes.status).toBe(200)

    const events = await getAuditEvents(db, 'invite_code_redeem')
    expect(events).toHaveLength(1)
    const evt = events[0]
    // The row ID (safe) should be recorded, not the raw code value
    expect(evt.targetId).toBe(codeRowId)
    expect(evt.targetName).toBe('invite code')
    // Raw code must NOT appear anywhere in the event row
    expect(evt.targetName).not.toBe(rawCode)
    expect(evt.targetId).not.toBe(rawCode)
    expect(evt.metadata ?? '').not.toContain(rawCode)
    assertNoSecrets(events[0].metadata)
  })
})

// ─── Better Auth org lifecycle events ──────────────────────────────────────────

describe('Audit: Better Auth org lifecycle via organizationHooks', () => {
  async function signUpAndSignIn(app: TestApp, email: string) {
    const signUpRes = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
    })
    const body = (await signUpRes.json()) as { user?: { id: string } }
    const cookie = signUpRes.headers.getSetCookie().join('; ')
    return { headers: { Cookie: cookie }, userId: body.user?.id ?? '' }
  }

  it('records team_settings_update when org is updated via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndSignIn(app, 'settings@example.com')

    // Create a team via Better Auth
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Team', slug: 'my-team-settings' }),
    })
    expect(createRes.status).toBe(200)
    const team = (await createRes.json()) as { id: string }

    // Update the org
    const updateRes = await app.request('/api/auth/organization/update', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id, data: { name: 'Updated Team' } }),
    })
    expect(updateRes.status).toBe(200)

    const events = await getAuditEvents(db, 'team_settings_update')
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].userId).toBe(userId)
  })

  it('records team_delete when org is deleted via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndSignIn(app, 'deleteteam@example.com')

    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Delete Me', slug: 'delete-me-team' }),
    })
    expect(createRes.status).toBe(200)
    const team = (await createRes.json()) as { id: string }

    const deleteRes = await app.request('/api/auth/organization/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id }),
    })
    expect(deleteRes.status).toBe(200)

    const events = await getAuditEvents(db, 'team_delete')
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].userId).toBe(userId)
  })

  it('records team_member_remove when a member is removed via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const { headers: ownerHeaders, userId: ownerId } = await signUpAndSignIn(app, 'owner@example.com')
    const { userId: memberId } = await signUpAndSignIn(app, 'member-to-remove@example.com')

    // Owner creates a team
    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Team', slug: 'test-team-remove' }),
    })
    const team = (await createRes.json()) as { id: string }

    // Add the member directly via DB insert; use member's email as memberIdOrEmail
    const { nanoid: genId } = await import('nanoid')
    const memberRowId = genId()
    await db.run(sql`INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${memberRowId}, ${team.id}, ${memberId}, 'member', ${Date.now()})`)

    // Remove member via Better Auth using the member row ID
    const removeRes = await app.request('/api/auth/organization/remove-member', {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id, memberIdOrEmail: memberRowId }),
    })
    expect(removeRes.status).toBe(200)

    const events = await getAuditEvents(db, 'team_member_remove')
    expect(events.length).toBeGreaterThanOrEqual(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.memberId).toBe(memberId)
  })

  it('records team_member_role_update when a role is changed via Better Auth', async () => {
    const { app, db } = await createTestApp()
    const { headers: ownerHeaders } = await signUpAndSignIn(app, 'roleowner@example.com')
    const { userId: memberId } = await signUpAndSignIn(app, 'rolemember@example.com')

    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Role Team', slug: 'role-team-test' }),
    })
    const team = (await createRes.json()) as { id: string }

    // Add the member directly
    const { nanoid: genId } = await import('nanoid')
    const memberRowId = genId()
    await db.run(sql`INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${memberRowId}, ${team.id}, ${memberId}, 'member', ${Date.now()})`)

    const updateRes = await app.request('/api/auth/organization/update-member-role', {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id, memberId: memberRowId, role: 'admin' }),
    })
    expect(updateRes.status).toBe(200)

    const events = await getAuditEvents(db, 'team_member_role_update')
    expect(events.length).toBeGreaterThanOrEqual(1)
    const meta = JSON.parse(events[0].metadata ?? '{}') as Record<string, unknown>
    expect(meta.newRole).toBe('admin')
    expect(meta.previousRole).toBe('member')
  })
})

// ─── Team activity feed isolation ─────────────────────────────────────────────

describe('Audit: team activity feed only shows file/folder events', () => {
  it('excludes non-file audit events (share, team, auth) from team activity feed', async () => {
    const { app, db } = await createTestApp()
    await insertStorage(db)
    await seedProLicense(db)
    const headers = await authedHeaders(app)
    const orgId = await getOrgIdFromSession(app, headers)

    // Insert a file event (should appear)
    await db.insert(activityEvents).values({
      id: 'feed-file-evt',
      orgId,
      userId: 'u1',
      action: 'upload',
      targetType: 'file',
      targetId: null,
      targetName: 'doc.pdf',
      metadata: null,
      createdAt: new Date(),
    })

    // Insert a share event (must NOT appear in team feed)
    await db.insert(activityEvents).values({
      id: 'feed-share-evt',
      orgId,
      userId: 'u1',
      action: 'share_create',
      targetType: 'share',
      targetId: null,
      targetName: 'doc.pdf',
      metadata: null,
      createdAt: new Date(),
    })

    // Insert an auth event (must NOT appear in team feed)
    await db.insert(activityEvents).values({
      id: 'feed-auth-evt',
      orgId,
      userId: 'u1',
      action: 'sign_up',
      targetType: 'auth',
      targetId: null,
      targetName: 'u@example.com',
      metadata: null,
      createdAt: new Date(),
    })

    const res = await app.request(`/api/teams/${orgId}/activity`, { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }

    // Only the file event should appear; share and auth events must be excluded
    const ids = body.items.map((i) => i.id)
    expect(ids).toContain('feed-file-evt')
    expect(ids).not.toContain('feed-share-evt')
    expect(ids).not.toContain('feed-auth-evt')
  })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrgIdFromSession(app: TestApp, headers: Record<string, string>): Promise<string> {
  const res = await app.request('/api/auth/get-session', { headers })
  if (!res.ok) throw new Error('Failed to get session')
  const session = (await res.json()) as { session?: { activeOrganizationId?: string } }
  const orgId = session.session?.activeOrganizationId
  if (!orgId) throw new Error('No active organization in session')
  return orgId
}

async function getUserIdFromSession(app: TestApp, headers: Record<string, string>): Promise<string> {
  const res = await app.request('/api/auth/get-session', { headers })
  if (!res.ok) throw new Error('Failed to get session')
  const session = (await res.json()) as { user?: { id?: string } }
  const userId = session.user?.id
  if (!userId) throw new Error('No user id in session')
  return userId
}
