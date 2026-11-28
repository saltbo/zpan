// Deleting a team through Better Auth purges what the team owned (issue #708):
// its files are purged on the trash path, releasing their stored objects and the
// storage they count against, and its quota, tasks, jobs, shares, invitations
// and image-hosting rows go with it. Another space's data is left alone.

import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3'
import { adminHeaders, createTestApp } from '../test/setup'
import { purgeDeletedOrganizations } from './organization-purge'

type TestApp = Awaited<ReturnType<typeof createTestApp>>
type TestDb = TestApp['db']

const STORAGE_ID = 'st-team-purge'

afterEach(() => {
  vi.restoreAllMocks()
})

async function count(db: TestDb, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.all<{ n: number }>(query)
  return rows[0]?.n ?? 0
}

async function seedSpace(db: TestDb, orgId: string, prefix: string, userId: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES
      (${`${prefix}-dir`}, ${orgId}, ${`${prefix}-dir-alias`}, 'docs', 'folder', 0, 1, '', '', ${STORAGE_ID}, 'active', NULL, ${now}, ${now}),
      (${`${prefix}-file`}, ${orgId}, ${`${prefix}-file-alias`}, 'a.txt', 'text/plain', 100, 0, 'docs', ${`${prefix}/a.txt`}, ${STORAGE_ID}, 'active', NULL, ${now}, ${now}),
      (${`${prefix}-trashed`}, ${orgId}, ${`${prefix}-trashed-alias`}, 'b.txt', 'text/plain', 50, 0, '', ${`${prefix}/b.txt`}, ${STORAGE_ID}, 'active', ${now}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO org_quota_entitlements (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, status, created_at, updated_at)
    VALUES (${`${prefix}-grant`}, ${orgId}, 'storage', 'grant', 'cloud', ${`${prefix}-order`}, 1000, ${now}, 'active', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO download_tasks (id, org_id, created_by_user_id, source_type, source_uri, status, created_at, updated_at)
    VALUES (${`${prefix}-task`}, ${orgId}, ${userId}, 'http', 'https://example.com/a.iso', 'queued', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO background_jobs (id, org_id, user_id, type, status, created_at, updated_at)
    VALUES (${`${prefix}-job`}, ${orgId}, ${userId}, 'archive_extract', 'queued', ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, status, created_at)
    VALUES (${`${prefix}-share`}, ${`${prefix}-token`}, 'landing', ${`${prefix}-file`}, ${orgId}, ${userId}, 'active', ${now})
  `)
  await db.run(sql`
    INSERT INTO webdav_locks (id, token, org_id, resource_path, expires_at, created_at, updated_at)
    VALUES (${`${prefix}-lock`}, ${`${prefix}-lock-token`}, ${orgId}, '/docs', ${now + 60_000}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO storage_usage_breakdowns (org_id, category, bytes, file_count, updated_at)
    VALUES (${orgId}, 'documents', 150, 2, ${now})
    ON CONFLICT DO NOTHING
  `)
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, created_at)
    VALUES (${`${prefix}-img`}, ${orgId}, ${`${prefix}-img-token`}, 'logo.png', ${STORAGE_ID}, ${`ih/${orgId}/logo.png`}, 10, 'image/png', 'active', ${now})
  `)
  await db.run(sql`
    INSERT INTO image_hosting_configs (org_id, created_at, updated_at) VALUES (${orgId}, ${now}, ${now})
  `)
  await db.run(sql`
    INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id)
    VALUES (${`${prefix}-invite`}, ${orgId}, ${`${prefix}@example.com`}, 'member', 'pending', ${now + 60_000}, ${userId})
  `)
  await db.run(sql`
    INSERT INTO team_invite_links (id, token, organization_id, role, inviter_id, created_at)
    VALUES (${`${prefix}-link`}, ${`${prefix}-link-token`}, ${orgId}, 'member', ${userId}, ${now})
  `)
  await db.run(sql`UPDATE org_quotas SET used = 160 WHERE org_id = ${orgId}`)
}

async function leftovers(db: TestDb, orgId: string) {
  return {
    liveMatters: await count(db, sql`SELECT COUNT(*) AS n FROM matters WHERE org_id = ${orgId} AND purged_at IS NULL`),
    quotas: await count(db, sql`SELECT COUNT(*) AS n FROM org_quotas WHERE org_id = ${orgId}`),
    grants: await count(db, sql`SELECT COUNT(*) AS n FROM org_quota_entitlements WHERE org_id = ${orgId}`),
    breakdowns: await count(db, sql`SELECT COUNT(*) AS n FROM storage_usage_breakdowns WHERE org_id = ${orgId}`),
    liveTasks: await count(
      db,
      sql`SELECT COUNT(*) AS n FROM download_tasks WHERE org_id = ${orgId} AND deleted_at IS NULL`,
    ),
    activeJobs: await count(
      db,
      sql`SELECT COUNT(*) AS n FROM background_jobs WHERE org_id = ${orgId} AND status IN ('queued', 'running')`,
    ),
    activeShares: await count(db, sql`SELECT COUNT(*) AS n FROM shares WHERE org_id = ${orgId} AND status = 'active'`),
    locks: await count(db, sql`SELECT COUNT(*) AS n FROM webdav_locks WHERE org_id = ${orgId}`),
    images: await count(db, sql`SELECT COUNT(*) AS n FROM image_hostings WHERE org_id = ${orgId}`),
    imageConfigs: await count(db, sql`SELECT COUNT(*) AS n FROM image_hosting_configs WHERE org_id = ${orgId}`),
    invitations: await count(db, sql`SELECT COUNT(*) AS n FROM invitation WHERE organization_id = ${orgId}`),
    inviteLinks: await count(db, sql`SELECT COUNT(*) AS n FROM team_invite_links WHERE organization_id = ${orgId}`),
  }
}

describe('deleting a team', () => {
  it('purges its files, quota grants, download tasks and other team-scoped rows [spec: teams/delete-purges-space]', async () => {
    const pending: Promise<unknown>[] = []
    const { app, db } = await createTestApp({}, {}, (task) => {
      pending.push(task)
    })
    const deleteObjects = vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
    const deleteObject = vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
    const headers = await adminHeaders(app)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 320, 'active', ${now}, ${now})
    `)

    const createRes = await app.request('/api/auth/organization/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Doomed Team', slug: 'doomed-team' }),
    })
    expect(createRes.status).toBe(200)
    const team = (await createRes.json()) as { id: string }
    const [admin] = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = 'admin@example.com'`)
    const [personal] = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE id != ${team.id} AND metadata LIKE '%"type":"personal"%'`,
    )

    await seedSpace(db, team.id, 'team', admin.id)
    await seedSpace(db, personal.id, 'mine', admin.id)
    const mineBefore = await leftovers(db, personal.id)

    const res = await app.request('/api/auth/organization/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: team.id }),
    })
    expect(res.status).toBe(200)
    await Promise.all(pending)

    expect(await leftovers(db, team.id)).toEqual({
      liveMatters: 0,
      quotas: 0,
      grants: 0,
      breakdowns: 0,
      liveTasks: 0,
      activeJobs: 0,
      activeShares: 0,
      locks: 0,
      images: 0,
      imageConfigs: 0,
      invitations: 0,
      inviteLinks: 0,
    })

    const released = [
      ...deleteObjects.mock.calls.flatMap(([, keys]) => keys),
      ...deleteObject.mock.calls.map(([, key]) => key),
    ]
    expect(released).toEqual(expect.arrayContaining(['team/a.txt', 'team/b.txt', `ih/${team.id}/logo.png`]))
    expect(released.some((key) => key.startsWith('mine/') || key.includes(personal.id))).toBe(false)

    // The team's 160 bytes no longer count against the storage; the personal space's still do.
    const [storage] = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${STORAGE_ID}`)
    expect(storage.used).toBe(160)

    expect(await leftovers(db, personal.id)).toEqual(mineBefore)
  })

  it('finishes, on the daily sweep, a purge the delete did not complete [spec: teams/delete-purge-resumes]', async () => {
    const { db, deps } = await createTestApp()
    vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${STORAGE_ID}, 'bucket', 'https://s3.example.com', 'auto', 'ak', 'sk', '', '', 0, 0, 'active', ${now}, ${now})
    `)
    // 'gone' is a deleted team; 'stray' has no organization row but was never
    // deleted as a team, so the sweep must not touch it.
    for (const orgId of ['gone', 'stray']) {
      await db.run(sql`INSERT INTO org_quotas (id, org_id, quota) VALUES (${`${orgId}-quota`}, ${orgId}, 1000)`)
      await db.run(sql`
        INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES (${`${orgId}-file`}, ${orgId}, ${`${orgId}-alias`}, 'a.txt', 'text/plain', 10, 0, '', ${`${orgId}/a.txt`}, ${STORAGE_ID}, 'active', ${now}, ${now})
      `)
    }
    await db.run(sql`
      INSERT INTO audit_events (id, org_id, user_id, action, target_type, target_id, target_name, created_at)
      VALUES ('evt-gone', 'gone', NULL, 'team_delete', 'team', 'gone', 'Gone', ${now})
    `)

    expect(await purgeDeletedOrganizations(deps)).toBe(1)
    expect(await leftovers(db, 'gone')).toMatchObject({ liveMatters: 0, quotas: 0 })
    expect(await leftovers(db, 'stray')).toMatchObject({ liveMatters: 1, quotas: 1 })
    expect(await purgeDeletedOrganizations(deps)).toBe(0)
  })
})
