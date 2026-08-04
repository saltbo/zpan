import { AMBIGUOUS_REDIRECT_SQL, idIntegrityScanSql, REDIRECT_REGISTRY_INTEGRITY_SQL } from '../server/db/id-integrity'

export interface IdBackfillBatchArtifact {
  version: 1
  digest: string
  statements: string[]
}

interface IdBackfillFinalizeRequest {
  version: 1
  digest: string
}

interface IdBackfillEnv {
  DB: D1Database
  ID_BACKFILL_AUTH_TOKEN: string
}

const CONFIRMATION = 'invalidate-credentials-and-links'
const FINALIZE_CONFIRMATION = 'finalize-id-normalization'
const MAP_TABLE = '_zpan_id_backfill_map'
const PENDING_DIGEST_KEY = 'id_normalization_pending_artifact_digest'
const D1_MAX_ARTIFACT_STATEMENTS = 47
const SAFE_ERROR_CODES = new Set([
  'invalid_backfill_artifact',
  'invalid_backfill_first_statement',
  'd1_query_limit_exceeded',
  'd1_statement_limit_exceeded',
  'backfill_artifact_digest_mismatch',
  'id_backfill_already_finalized',
  'different_backfill_artifact_already_applied',
  'invalid_finalize_request',
  'backfill_mapping_missing',
  'backfill_artifact_digest_not_applied',
  'foreign_key_check_failed',
  'id_integrity_failed',
  'redirect_tokens_ambiguous',
  'redirect_registry_inconsistent',
])

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'maintenance_provider_failure'
  const code = error.message.split(':', 1)[0] ?? ''
  return SAFE_ERROR_CODES.has(code) ? code : 'maintenance_provider_failure'
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function equalSecret(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256Hex(left), sha256Hex(right)])
  let difference = leftDigest.length ^ rightDigest.length
  for (let index = 0; index < Math.max(leftDigest.length, rightDigest.length); index += 1) {
    difference |= (leftDigest.charCodeAt(index) || 0) ^ (rightDigest.charCodeAt(index) || 0)
  }
  return difference === 0
}

export async function applyIdBackfillArtifact(
  db: D1Database,
  artifact: IdBackfillBatchArtifact,
  expectedDigest: string,
): Promise<{ statements: number; digest: string }> {
  if (artifact.version !== 1 || artifact.statements.length === 0) throw new Error('invalid_backfill_artifact')
  if (artifact.statements.length > D1_MAX_ARTIFACT_STATEMENTS) throw new Error('d1_query_limit_exceeded')
  if (artifact.statements[0]?.trim() !== 'PRAGMA defer_foreign_keys = ON;')
    throw new Error('invalid_backfill_first_statement')
  if (artifact.statements.some((statement) => new TextEncoder().encode(statement).length > 100_000)) {
    throw new Error('d1_statement_limit_exceeded')
  }
  const digest = await sha256Hex(JSON.stringify(artifact.statements))
  if (digest !== artifact.digest || digest !== expectedDigest) throw new Error('backfill_artifact_digest_mismatch')
  const completion = await db
    .prepare("SELECT value FROM system_options WHERE key = 'id_normalization_version'")
    .first<{ value: string }>()
  if (completion) throw new Error(`id_backfill_already_finalized:${completion.value}`)
  const pending = await db
    .prepare('SELECT value FROM system_options WHERE key = ?')
    .bind(PENDING_DIGEST_KEY)
    .first<{ value: string }>()
  if (pending) {
    if (pending.value !== digest) throw new Error('different_backfill_artifact_already_applied')
    return { statements: artifact.statements.length, digest }
  }
  await db.batch([
    ...artifact.statements.map((statement) => db.prepare(statement)),
    db.prepare('INSERT INTO system_options (key, value) VALUES (?, ?)').bind(PENDING_DIGEST_KEY, digest),
  ])
  return { statements: artifact.statements.length, digest }
}

async function assertD1BackfillPostconditions(db: D1Database): Promise<void> {
  const scans = idIntegrityScanSql()
  for (let offset = 0; offset < scans.length; offset += 5) {
    const results = await db.prepare(scans.slice(offset, offset + 5).join(' UNION ALL ')).all<{ count: number }>()
    if (results.results.some(({ count }) => count > 0)) throw new Error('id_integrity_failed')
  }
  const ambiguous = await db.prepare(AMBIGUOUS_REDIRECT_SQL).first<{ count: number }>()
  if ((ambiguous?.count ?? 0) > 0) throw new Error('redirect_tokens_ambiguous')
  const registry = await db.prepare(REDIRECT_REGISTRY_INTEGRITY_SQL).all<{ count: number }>()
  if (registry.results.some(({ count }) => count > 0)) throw new Error('redirect_registry_inconsistent')
}

export async function finalizeIdBackfill(
  db: D1Database,
  request: IdBackfillFinalizeRequest,
): Promise<{ digest: string }> {
  if (request.version !== 1 || !/^[a-f0-9]{64}$/.test(request.digest)) throw new Error('invalid_finalize_request')
  const completion = await db
    .prepare("SELECT value FROM system_options WHERE key = 'id_normalization_version'")
    .first<{ value: string }>()
  if (completion) throw new Error(`id_backfill_already_finalized:${completion.value}`)
  const mapping = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(MAP_TABLE)
    .first<{ name: string }>()
  if (!mapping) throw new Error('backfill_mapping_missing')
  const pending = await db
    .prepare('SELECT value FROM system_options WHERE key = ?')
    .bind(PENDING_DIGEST_KEY)
    .first<{ value: string }>()
  if (!pending || pending.value !== request.digest) throw new Error('backfill_artifact_digest_not_applied')
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeys.results.length > 0) throw new Error('foreign_key_check_failed')
  await assertD1BackfillPostconditions(db)

  await db.batch([
    db.prepare('INSERT INTO system_options (key, value) VALUES (?, ?)').bind('id_normalization_version', '1'),
    db
      .prepare('INSERT INTO system_options (key, value) VALUES (?, ?)')
      .bind('id_normalization_artifact_digest', request.digest),
    db.prepare('DELETE FROM system_options WHERE key = ?').bind(PENDING_DIGEST_KEY),
    db.prepare(`DROP TABLE ${MAP_TABLE}`),
  ])
  return { digest: request.digest }
}

export default {
  async fetch(request: Request, env: IdBackfillEnv): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not found', { status: 404 })
    const path = new URL(request.url).pathname
    if (path !== '/' && path !== '/apply' && path !== '/finalize') return new Response('Not found', { status: 404 })
    const authorization = request.headers.get('Authorization')
    const providedToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!env.ID_BACKFILL_AUTH_TOKEN || !(await equalSecret(providedToken, env.ID_BACKFILL_AUTH_TOKEN))) {
      return new Response('Unauthorized', { status: 401 })
    }
    const confirmation = path === '/finalize' ? FINALIZE_CONFIRMATION : CONFIRMATION
    if (request.headers.get('X-ZPan-ID-Backfill-Confirm') !== confirmation) {
      return new Response('Explicit confirmation required', { status: 400 })
    }
    try {
      if (path === '/finalize') {
        const finalize = (await request.json()) as IdBackfillFinalizeRequest
        return Response.json({ ok: true, ...(await finalizeIdBackfill(env.DB, finalize)) })
      }
      const expectedDigest = request.headers.get('X-ZPan-ID-Backfill-Digest') ?? ''
      const artifact = (await request.json()) as IdBackfillBatchArtifact
      return Response.json({ ok: true, ...(await applyIdBackfillArtifact(env.DB, artifact, expectedDigest)) })
    } catch (error) {
      const code = safeErrorCode(error)
      const requestId = crypto.randomUUID()
      console.error(`ID backfill operation failed code=${code} requestId=${requestId}`)
      return Response.json({ ok: false, error: code, requestId }, { status: 500 })
    }
  },
}
