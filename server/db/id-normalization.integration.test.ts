import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup'
import { assertNormalizedIdentifiers } from './id-normalization'

describe('normalized identifier startup contract', () => {
  it('marks a fresh database so a later restart accepts newly created records', async () => {
    const { db } = await createTestApp()
    // createTestApp initializes the configured OAuth resource; a real runtime runs
    // this gate before auth initialization, so remove that seed to model first boot.
    await db.run(sql.raw('DELETE FROM oauthResource'))

    await expect(assertNormalizedIdentifiers(db)).resolves.toBeUndefined()
    expect(
      await db.all<{ value: string }>(
        sql.raw("SELECT value FROM _zpan_id_normalization_state WHERE key = 'validation_version'"),
      ),
    ).toEqual([{ value: '1' }])
    await db.run(sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('CreatedAfterBoot', 'New', 'new@example.com', 1, 0, 0)`)
    await expect(assertNormalizedIdentifiers(db)).resolves.toBeUndefined()
  })

  it('accepts a migrated database with a completion marker', async () => {
    const { db } = await createTestApp()
    await db.run(sql.raw('CREATE TABLE _zpan_id_normalization_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'))
    await db.run(
      sql.raw("INSERT INTO _zpan_id_normalization_state VALUES ('completed_at', '1'), ('validation_version', '1')"),
    )
    await expect(assertNormalizedIdentifiers(db)).resolves.toBeUndefined()
  })

  it('rejects a completion marker that was not produced by the versioned validation gate', async () => {
    const { db } = await createTestApp()
    await db.run(sql.raw('CREATE TABLE _zpan_id_normalization_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'))
    await db.run(sql.raw("INSERT INTO _zpan_id_normalization_state VALUES ('completed_at', '1')"))

    await expect(assertNormalizedIdentifiers(db)).rejects.toThrow('id_normalization_validation_marker_missing')
  })

  it('rejects a populated database when the one-time normalization has not completed', async () => {
    const { db } = await createTestApp()
    await db.run(sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('AlreadyBase62', 'Existing', 'existing@example.com', 1, 0, 0)`)

    await expect(assertNormalizedIdentifiers(db)).rejects.toThrow('id_normalization_not_completed')
  })

  it('does not mistake standalone OAuth state for a fresh empty database', async () => {
    const { db } = await createTestApp()

    await expect(assertNormalizedIdentifiers(db)).rejects.toThrow('id_normalization_not_completed')
  })

  it('does not bless a database that only has an existing instance identity', async () => {
    const { db } = await createTestApp()
    await db.run(sql.raw('DELETE FROM oauthResource'))
    await db.run(sql.raw("INSERT INTO system_options (key, value) VALUES ('instance_id', 'legacy-instance-id')"))

    await expect(assertNormalizedIdentifiers(db)).rejects.toThrow('id_normalization_not_completed')
  })

  it('accepts a populated normalized database with a completion marker', async () => {
    const { db } = await createTestApp()
    await db.run(sql`INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('AlreadyBase62', 'Existing', 'existing@example.com', 1, 0, 0)`)
    await db.run(sql.raw('CREATE TABLE _zpan_id_normalization_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'))
    await db.run(
      sql.raw("INSERT INTO _zpan_id_normalization_state VALUES ('completed_at', '1'), ('validation_version', '1')"),
    )

    await expect(assertNormalizedIdentifiers(db)).resolves.toBeUndefined()
  })
})
