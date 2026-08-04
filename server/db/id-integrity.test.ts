import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../test/setup'
import { assertIdIntegrity } from './id-integrity'

describe('ID integrity release guard', () => {
  it('marks a fresh empty database once and later starts through one checkpoint query', async () => {
    const { app, db } = await createTestApp()
    // createTestApp initializes Better Auth first; production bootstrap runs
    // the integrity guard before auth creates its initial signing key.
    await db.run(sql`DELETE FROM jwks`)
    await db.run(sql`DELETE FROM oauthResource`)
    await expect(assertIdIntegrity(db)).resolves.toBeUndefined()
    expect(
      await db.all<{ value: string }>(sql`
        SELECT value FROM system_options WHERE key = 'id_normalization_version'
      `),
    ).toEqual([{ value: '1' }])

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ID Guard', email: 'id-guard@example.com', password: 'password123456' }),
    })
    const all = vi.spyOn(db, 'all')
    await expect(assertIdIntegrity(db)).resolves.toBeUndefined()
    expect(all).toHaveBeenCalledTimes(1)
    all.mockRestore()
  })

  it('rejects malformed completion and pending checkpoints', async () => {
    const { db } = await createTestApp()
    await db.run(sql`INSERT INTO system_options (key, value) VALUES ('id_normalization_version', '2')`)
    await expect(assertIdIntegrity(db)).rejects.toThrow('id_integrity_checkpoint_invalid:id_normalization_version')
    await db.run(sql`DELETE FROM system_options WHERE key = 'id_normalization_version'`)
    await db.run(sql`
      INSERT INTO system_options (key, value)
      VALUES ('id_normalization_pending_artifact_digest', 'not-a-digest')
    `)
    await expect(assertIdIntegrity(db)).rejects.toThrow(
      'id_integrity_checkpoint_invalid:id_normalization_pending_artifact_digest',
    )
  })

  it('does not mark an upgrade database with only a retained structured reference', async () => {
    const { db } = await createTestApp()
    await db.run(sql`DELETE FROM jwks`)
    await db.run(sql`DELETE FROM oauthResource`)
    await db.run(sql`
      INSERT INTO resource_changes (
        scope_type, scope_id, resource_type, resource_id, change_type, metadata, occurred_at
      ) VALUES ('organization', 'legacy_org', 'share', 'legacy-share', 'upsert', '{"shareId":"legacy-share"}', 1)
    `)

    await expect(assertIdIntegrity(db)).rejects.toThrow('id_normalization_checkpoint_required')
    expect(await db.all(sql`SELECT value FROM system_options WHERE key = 'id_normalization_version'`)).toEqual([])
  })

  it('does not mark an upgrade database with only an invalidated credential row', async () => {
    const { db } = await createTestApp()
    await db.run(sql`DELETE FROM jwks`)
    await db.run(sql`DELETE FROM oauthResource`)
    await db.run(sql`INSERT INTO oauthClientAssertion (id, expires_at) VALUES ('legacy_assertion', 1)`)

    await expect(assertIdIntegrity(db)).rejects.toThrow('id_normalization_checkpoint_required')
    expect(await db.all(sql`SELECT value FROM system_options WHERE key = 'id_normalization_version'`)).toEqual([])
  })

  it('fails fast with counts but does not print identifier values', async () => {
    const { db } = await createTestApp()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('secret_bad-id', 'bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '', '', 0, 0, 'active', 0, 0)
    `)
    await expect(assertIdIntegrity(db)).rejects.toThrow('id_integrity_failed:storages.id=1')
    await expect(assertIdIntegrity(db)).rejects.not.toThrow('secret_bad-id')
  })

  it('fails when a redirect resource is missing its transactional reservation', async () => {
    const { db } = await createTestApp()
    await db.run(sql`
      INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, status, created_at)
      VALUES ('ShareId1', 'SharedToken1', 'direct', 'MatterId1', 'OrgId1', 'UserId1', 'active', 0)
    `)

    await expect(assertIdIntegrity(db)).rejects.toThrow('redirect_tokens.registry=1')
  })
})
