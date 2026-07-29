import { defaultKeyHasher } from '@better-auth/api-key'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

function futureIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

async function getUserAndPersonalOrg(db: TestApp['db'], email = 'test@example.com') {
  const users = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  const orgs = await db.all<{ id: string }>(sql`
    SELECT o.id
    FROM organization o
    INNER JOIN member m ON m.organization_id = o.id
    WHERE m.user_id = ${users[0]?.id} AND o.metadata LIKE '%"type":"personal"%'
    LIMIT 1
  `)
  if (!users[0] || !orgs[0]) throw new Error('expected user and personal org')
  return { userId: users[0].id, orgId: orgs[0].id }
}

async function insertStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (
      id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, enabled, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      'st-agent', 'test-bucket', 'https://s3.amazonaws.com', 'us-east-1',
      'AKIAIOSFODNN7EXAMPLE', 'secret', '', '', 0, 0, 1, 'untested',
      0, ${100 * 1024 ** 2}, 1, ${now}, ${now}
    )
  `)
}

async function insertFile(db: TestApp['db'], orgId: string, id: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${`${id}-alias`}, ${`${id}.txt`}, 'text/plain', 100, 0, '', 'some/key.txt', 'st-agent', 'active', NULL, ${now}, ${now})
  `)
}

async function insertLandingShare(
  db: TestApp['db'],
  input: { token: string; orgId: string; matterId: string; userId: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, status, private, created_at)
    VALUES (${`${input.token}-id`}, ${input.token}, 'landing', ${input.matterId}, ${input.orgId}, ${input.userId}, 'active', 0, ${now})
  `)
}

async function insertTeamOrg(db: TestApp['db'], orgId: string, userId: string, role = 'editor') {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
    VALUES (${orgId}, ${`Team ${orgId}`}, ${orgId}, '{"type":"team"}', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (${`${orgId}-member`}, ${orgId}, ${userId}, ${role}, ${now})
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`${orgId}-quota`}, ${orgId}, 1000000, 0, 0, 0, '1970-01')
  `)
}

async function createAgentKey(app: TestApp['app'], headers: Record<string, string>, orgId: string, scopes: string[]) {
  const res = await app.request(`/api/workspaces/${orgId}/agent-api-keys`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CI', scopes, expiresAt: futureIso(90) }),
  })
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as { key: string; item: { id: string; orgId: string; scopes: string[]; status: string } }
}

async function insertLegacyAgentKey(db: TestApp['db'], userId: string): Promise<string> {
  const now = Date.now()
  const key = 'zpan_agent_legacy_integration_key'
  const hashedKey = await defaultKeyHasher(key)
  await db.run(sql`
    INSERT INTO apikey (
      id, config_id, name, start, reference_id, prefix, key,
      enabled, rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count,
      expires_at, created_at, updated_at, permissions, metadata
    )
    VALUES (
      'legacy-agent-key', 'agent', 'Legacy Agent key', 'zpan_age', ${userId}, 'zpan_agent_', ${hashedKey},
      1, 1, 60000, 600, 0,
      ${now + 90 * 24 * 60 * 60 * 1000}, ${now}, ${now}, '{"objects":["read"]}', NULL
    )
  `)
  return key
}

describe('Agent API keys', () => {
  it('creates, lists, rotates, and revokes a personal workspace key [spec: agent-api-keys/lifecycle]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { orgId } = await getUserAndPersonalOrg(db)

    const created = await createAgentKey(app, headers, orgId, ['objects:read'])
    expect(created.key).toMatch(/^zpan_agent_/)
    expect(created.item).toMatchObject({ orgId, scopes: ['objects:read'], status: 'active' })

    const list = await app.request(`/api/workspaces/${orgId}/agent-api-keys`, { headers })
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { items: Array<{ id: string; key?: string }> }
    expect(listed.items.map((item) => item.id)).toContain(created.item.id)
    expect(listed.items[0]?.key).toBeUndefined()

    const rotated = await app.request(`/api/workspaces/${orgId}/agent-api-keys/${created.item.id}/rotations`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(rotated.status).toBe(201)
    const rotatedBody = (await rotated.json()) as { key: string; item: { id: string } }
    expect(rotatedBody.key).toMatch(/^zpan_agent_/)
    expect(rotatedBody.item.id).not.toBe(created.item.id)

    const revoke = await app.request(`/api/workspaces/${orgId}/agent-api-keys/${rotatedBody.item.id}`, {
      method: 'DELETE',
      headers,
    })
    expect(revoke.status).toBe(204)
  })

  it('creates and uses a team workspace key for allowed file operations [spec: agent-api-keys/team-file-ops]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const { userId } = await getUserAndPersonalOrg(db)
    await insertTeamOrg(db, 'agent-team', userId, 'editor')
    await insertFile(db, 'agent-team', 'agent-readable')
    const created = await createAgentKey(app, headers, 'agent-team', ['objects:read', 'objects:create'])
    const auth = { Authorization: `Bearer ${created.key}` }

    const list = await app.request('/api/objects', { headers: auth })
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as { items: Array<{ id: string }> }
    expect(listBody.items.map((item) => item.id)).toContain('agent-readable')

    const create = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'agent-folder', type: 'folder', dirtype: 1, parent: '' }),
    })
    expect(create.status).toBe(201)
  })

  it('rejects disallowed scopes and raw Better Auth Agent key creation [spec: agent-api-keys/scope-boundary]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { orgId } = await getUserAndPersonalOrg(db)

    const disallowed = await app.request(`/api/workspaces/${orgId}/agent-api-keys`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad', scopes: ['images:upload'], expiresAt: futureIso(90) }),
    })
    expect(disallowed.status).toBe(400)

    const raw = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId: 'agent', organizationId: orgId, permissions: { images: ['upload'] } }),
    })
    expect(raw.status).toBe(400)
  })

  it('denies missing scope, wrong workspace, revoked key, expired key, and banned owner [spec: agent-api-keys/denials]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { orgId, userId } = await getUserAndPersonalOrg(db)
    await insertStorage(db)
    const created = await createAgentKey(app, headers, orgId, ['objects:create'])
    const auth = { Authorization: `Bearer ${created.key}` }

    const missingScope = await app.request('/api/objects', { headers: auth })
    expect(missingScope.status).toBe(403)

    const wrongWorkspace = await app.request('/api/objects?orgId=agent-other-workspace', { headers: auth })
    expect(wrongWorkspace.status).toBe(403)

    await app.request(`/api/workspaces/${orgId}/agent-api-keys/${created.item.id}`, { method: 'DELETE', headers })
    const revoked = await app.request('/api/objects', { headers: auth })
    expect(revoked.status).toBe(401)

    const expired = await createAgentKey(app, headers, orgId, ['objects:read'])
    await db.run(sql`UPDATE apikey SET expires_at = ${Date.now() - 1000} WHERE id = ${expired.item.id}`)
    const expiredRes = await app.request('/api/objects', { headers: { Authorization: `Bearer ${expired.key}` } })
    expect(expiredRes.status).toBe(401)

    const banned = await createAgentKey(app, headers, orgId, ['objects:read'])
    await db.run(sql`UPDATE user SET banned = 1 WHERE id = ${userId}`)
    const bannedRes = await app.request('/api/objects', { headers: { Authorization: `Bearer ${banned.key}` } })
    expect(bannedRes.status).toBe(401)
  })

  it('rechecks team role before management and file operations [spec: agent-api-keys/role-reduction]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { userId } = await getUserAndPersonalOrg(db)
    await insertStorage(db)
    await insertTeamOrg(db, 'agent-role-team', userId, 'editor')
    await insertFile(db, 'agent-role-team', 'agent-role-share-file')
    await insertLandingShare(db, {
      token: 'agent-role-share',
      orgId: 'agent-role-team',
      matterId: 'agent-role-share-file',
      userId,
    })
    const created = await createAgentKey(app, headers, 'agent-role-team', [
      'objects:create',
      'shares:create',
      'shares:delete',
    ])
    await db.run(
      sql`UPDATE member SET role = 'viewer' WHERE organization_id = 'agent-role-team' AND user_id = ${userId}`,
    )
    const auth = { Authorization: `Bearer ${created.key}`, 'Content-Type': 'application/json' }

    const management = await app.request('/api/workspaces/agent-role-team/agent-api-keys', { headers })
    expect(management.status).toBe(403)

    const create = await app.request('/api/objects', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'blocked', type: 'folder', dirtype: 1, parent: '' }),
    })
    expect(create.status).toBe(403)

    const privacy = await app.request('/api/shares/agent-role-share/privacy', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ private: true }),
    })
    expect(privacy.status).toBe(403)

    const revoke = await app.request('/api/shares/agent-role-share/status', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ status: 'revoked' }),
    })
    expect(revoke.status).toBe(403)
  })

  it('denies an old team workspace key after the owner membership is removed [spec: agent-api-keys/denials]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { userId } = await getUserAndPersonalOrg(db)
    await insertStorage(db)
    await insertTeamOrg(db, 'agent-removed-team', userId, 'editor')
    await insertFile(db, 'agent-removed-team', 'agent-removed-readable')
    const created = await createAgentKey(app, headers, 'agent-removed-team', ['objects:read'])

    await db.run(sql`DELETE FROM member WHERE organization_id = 'agent-removed-team' AND user_id = ${userId}`)

    const denied = await app.request('/api/objects?orgId=agent-removed-team', {
      headers: { Authorization: `Bearer ${created.key}` },
    })
    expect(denied.status).toBe(403)
  })

  it('denies a legacy Better Auth Agent key without scoped metadata [spec: agent-api-keys/denials]', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app)
    const { userId } = await getUserAndPersonalOrg(db)
    const key = await insertLegacyAgentKey(db, userId)

    const denied = await app.request('/api/objects', { headers: { Authorization: `Bearer ${key}` } })
    expect(denied.status).toBe(401)
  })
})
