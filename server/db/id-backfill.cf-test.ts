import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import idBackfillWorker, {
  applyIdBackfillArtifact,
  finalizeIdBackfill,
  type IdBackfillBatchArtifact,
} from '../../workers/id-backfill'

const SUBJECT = '_zpan_id_backfill_cf_subject'
const CHILD = '_zpan_id_backfill_cf_child'
const MAP = '_zpan_id_backfill_map'
const PUBLIC = '_zpan_id_backfill_cf_public'
const EVENT = '_zpan_id_backfill_cf_event'
const CREDENTIAL = '_zpan_id_backfill_cf_credential'

async function artifact(statements: string[]): Promise<IdBackfillBatchArtifact> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(statements))),
  )
  const digest = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { version: 1, digest, statements }
}

async function resetFixture(): Promise<void> {
  await env.DB.exec(`
    DROP TABLE IF EXISTS ${CHILD};
    DROP TABLE IF EXISTS ${SUBJECT};
    DROP TABLE IF EXISTS ${MAP};
    DROP TABLE IF EXISTS ${PUBLIC};
    DROP TABLE IF EXISTS ${EVENT};
    DROP TABLE IF EXISTS ${CREDENTIAL};
    CREATE TABLE ${SUBJECT} (id TEXT PRIMARY KEY);
    CREATE TABLE ${CHILD} (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES ${SUBJECT}(id));
    CREATE TABLE ${MAP} (old_value TEXT PRIMARY KEY, new_value TEXT NOT NULL UNIQUE);
    CREATE TABLE ${PUBLIC} (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE);
    CREATE TABLE ${EVENT} (id TEXT PRIMARY KEY, event_key TEXT, metadata TEXT);
    CREATE TABLE ${CREDENTIAL} (id TEXT PRIMARY KEY, secret TEXT);
    CREATE TABLE IF NOT EXISTS system_options (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    DELETE FROM system_options WHERE key IN ('id_normalization_version', 'id_normalization_artifact_digest', 'id_normalization_pending_artifact_digest');
    INSERT INTO ${SUBJECT} VALUES ('legacy_id');
    INSERT INTO ${CHILD} VALUES ('child', 'legacy_id');
    INSERT INTO ${PUBLIC} VALUES ('public', 'ds_legacy');
    INSERT INTO ${EVENT} VALUES ('event:user:legacy_id', NULL, '{"matterId":"legacy_id","matterIds":["legacy_id"]}');
    INSERT INTO ${CREDENTIAL} VALUES ('credential', 'secret');
  `)
}

function representativeStatements(): string[] {
  return [
    'PRAGMA defer_foreign_keys = ON;',
    `INSERT INTO ${MAP} VALUES ('legacy_id', 'Base62Replacement')`,
    `UPDATE ${CHILD} SET subject_id = (SELECT new_value FROM ${MAP} WHERE old_value = subject_id)`,
    `UPDATE ${EVENT} SET event_key = replace(id, 'legacy_id', 'Base62Replacement'), metadata = json_set(metadata, '$.matterId', 'Base62Replacement', '$.matterIds[0]', 'Base62Replacement')`,
    `UPDATE ${SUBJECT} SET id = (SELECT new_value FROM ${MAP} WHERE old_value = id)`,
    `UPDATE ${PUBLIC} SET token = 'PublicBase62Token'`,
    `DELETE FROM ${CREDENTIAL}`,
  ]
}

describe('[CF] ID backfill D1 transaction rehearsal', () => {
  it('defers FKs while atomically rewriting a PK and its reference', async () => {
    await resetFixture()
    const plan = await artifact(representativeStatements())
    const response = await idBackfillWorker.fetch(
      new Request('https://maintenance.invalid/', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rehearsal-secret',
          'Content-Type': 'application/json',
          'X-ZPan-ID-Backfill-Confirm': 'invalidate-credentials-and-links',
          'X-ZPan-ID-Backfill-Digest': plan.digest,
        },
        body: JSON.stringify(plan),
      }),
      { DB: env.DB, ID_BACKFILL_AUTH_TOKEN: 'rehearsal-secret' },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      statements: plan.statements.length,
      digest: plan.digest,
    })

    const row = await env.DB.prepare(
      `SELECT s.id, c.subject_id AS subjectId FROM ${SUBJECT} s JOIN ${CHILD} c ON c.subject_id = s.id`,
    ).first<{ id: string; subjectId: string }>()
    expect(row).toEqual({ id: 'Base62Replacement', subjectId: 'Base62Replacement' })
    const foreignKeys = await env.DB.prepare(`PRAGMA foreign_key_check(${CHILD})`).all()
    expect(foreignKeys.results).toEqual([])
    expect(await env.DB.prepare(`SELECT token FROM ${PUBLIC}`).first()).toEqual({ token: 'PublicBase62Token' })
    expect(await env.DB.prepare(`SELECT event_key AS eventKey, metadata FROM ${EVENT}`).first()).toEqual({
      eventKey: 'event:user:Base62Replacement',
      metadata: '{"matterId":"Base62Replacement","matterIds":["Base62Replacement"]}',
    })
    expect(
      (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${CREDENTIAL}`).first<{ count: number }>())?.count,
    ).toBe(0)
  })

  it('rolls the whole D1 batch back when a later statement fails', async () => {
    await resetFixture()
    const plan = await artifact([...representativeStatements(), `INSERT INTO ${SUBJECT} VALUES ('Base62Replacement')`])
    await expect(applyIdBackfillArtifact(env.DB, plan, plan.digest)).rejects.toThrow()

    const subject = await env.DB.prepare(`SELECT id FROM ${SUBJECT}`).first<{ id: string }>()
    const child = await env.DB.prepare(`SELECT subject_id AS subjectId FROM ${CHILD}`).first<{ subjectId: string }>()
    expect(subject?.id).toBe('legacy_id')
    expect(child?.subjectId).toBe('legacy_id')
    expect(await env.DB.prepare(`SELECT token FROM ${PUBLIC}`).first()).toEqual({ token: 'ds_legacy' })
    expect(
      (await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${CREDENTIAL}`).first<{ count: number }>())?.count,
    ).toBe(1)
  })

  it('rejects a modified or mismatched artifact before sending a D1 batch', async () => {
    await resetFixture()
    const plan = await artifact(representativeStatements())
    plan.statements[1] = `DELETE FROM ${SUBJECT}`
    await expect(applyIdBackfillArtifact(env.DB, plan, plan.digest)).rejects.toThrow(
      'backfill_artifact_digest_mismatch',
    )
    expect(await env.DB.prepare(`SELECT id FROM ${SUBJECT}`).first()).toEqual({ id: 'legacy_id' })
  })

  it('rejects an artifact that would exceed the D1 free-plan invocation budget', async () => {
    await resetFixture()
    const plan = await artifact(['PRAGMA defer_foreign_keys = ON;', ...Array.from({ length: 47 }, () => 'SELECT 1')])

    await expect(applyIdBackfillArtifact(env.DB, plan, plan.digest)).rejects.toThrow('d1_query_limit_exceeded')
  })

  it('rejects an artifact after the backfill has been finalized', async () => {
    await resetFixture()
    await env.DB.prepare("INSERT INTO system_options VALUES ('id_normalization_version', '1')").run()
    const plan = await artifact(representativeStatements())

    await expect(applyIdBackfillArtifact(env.DB, plan, plan.digest)).rejects.toThrow('id_backfill_already_finalized:1')
    expect(await env.DB.prepare(`SELECT id FROM ${SUBJECT}`).first()).toEqual({ id: 'legacy_id' })
  })

  it('finalizes atomically through the authenticated maintenance endpoint', async () => {
    await resetFixture()
    const plan = await artifact(representativeStatements())
    await applyIdBackfillArtifact(env.DB, plan, plan.digest)
    await expect(finalizeIdBackfill(env.DB, { version: 1, digest: plan.digest })).resolves.toEqual({
      digest: plan.digest,
    })

    await resetFixture()
    await applyIdBackfillArtifact(env.DB, plan, plan.digest)
    const response = await idBackfillWorker.fetch(
      new Request('https://maintenance.invalid/finalize', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer rehearsal-secret',
          'Content-Type': 'application/json',
          'X-ZPan-ID-Backfill-Confirm': 'finalize-id-normalization',
        },
        body: JSON.stringify({ version: 1, digest: plan.digest }),
      }),
      { DB: env.DB, ID_BACKFILL_AUTH_TOKEN: 'rehearsal-secret' },
    )

    expect(response.status).toBe(200)
    expect(
      await env.DB.prepare("SELECT value FROM system_options WHERE key = 'id_normalization_version'").first(),
    ).toEqual({
      value: '1',
    })
    expect(
      await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = '_zpan_id_backfill_map'").first(),
    ).toBeNull()
    await expect(finalizeIdBackfill(env.DB, { version: 1, digest: plan.digest })).rejects.toThrow(
      'id_backfill_already_finalized:1',
    )
  })
})
