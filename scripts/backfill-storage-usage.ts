import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

type Target =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

interface Options {
  apply: boolean
  target: Target
}

interface Summary {
  organizations: number
  projectionRows: number
  projectionFiles: number
  projectionBytes: number
  activeFiles: number
  activeFileBytes: number
  activeImages: number
  activeImageBytes: number
}

export function buildStorageUsageBackfillSql(now: number): string {
  return `
WITH categories(category) AS (
  VALUES
    ('photos'),
    ('videos'),
    ('music'),
    ('documents'),
    ('archives'),
    ('other'),
    ('image_hosting'),
    ('trash')
),
matter_totals AS (
  SELECT
    org_id,
    CASE
      WHEN trashed_at IS NOT NULL THEN 'trash'
      WHEN lower(type) LIKE 'image/%' THEN 'photos'
      WHEN lower(type) LIKE 'video/%' THEN 'videos'
      WHEN lower(type) LIKE 'audio/%' THEN 'music'
      WHEN lower(type) LIKE 'text/%'
        OR lower(type) IN (
          'application/epub+zip',
          'application/msword',
          'application/pdf',
          'application/rtf',
          'application/vnd.ms-excel',
          'application/vnd.ms-powerpoint',
          'application/vnd.oasis.opendocument.presentation',
          'application/vnd.oasis.opendocument.spreadsheet',
          'application/vnd.oasis.opendocument.text',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) THEN 'documents'
      WHEN lower(type) IN (
        'application/gzip',
        'application/vnd.rar',
        'application/x-7z-compressed',
        'application/x-bzip2',
        'application/x-rar-compressed',
        'application/x-tar',
        'application/zip'
      ) THEN 'archives'
      ELSE 'other'
    END AS category,
    SUM(COALESCE(size, 0)) AS bytes,
    COUNT(*) AS file_count
  FROM matters
  WHERE status = 'active'
    AND dirtype = 0
    AND purged_at IS NULL
  GROUP BY org_id, category
),
image_totals AS (
  SELECT
    org_id,
    'image_hosting' AS category,
    SUM(COALESCE(size, 0)) AS bytes,
    COUNT(*) AS file_count
  FROM image_hostings
  WHERE status = 'active'
    AND purged_at IS NULL
  GROUP BY org_id
),
totals AS (
  SELECT org_id, category, bytes, file_count FROM matter_totals
  UNION ALL
  SELECT org_id, category, bytes, file_count FROM image_totals
),
aggregated AS (
  SELECT
    org_id,
    category,
    SUM(bytes) AS bytes,
    SUM(file_count) AS file_count
  FROM totals
  GROUP BY org_id, category
)
INSERT INTO storage_usage_breakdowns (org_id, category, bytes, file_count, updated_at)
SELECT
  organization.id,
  categories.category,
  COALESCE(aggregated.bytes, 0),
  COALESCE(aggregated.file_count, 0),
  ${now}
FROM organization
CROSS JOIN categories
LEFT JOIN aggregated
  ON aggregated.org_id = organization.id
  AND aggregated.category = categories.category
WHERE 1
ON CONFLICT(org_id, category) DO UPDATE SET
  bytes = excluded.bytes,
  file_count = excluded.file_count,
  updated_at = excluded.updated_at;
`.trim()
}

const SUMMARY_SQL = `
SELECT json_object(
  'organizations', (SELECT COUNT(*) FROM organization),
  'projectionRows', (
    SELECT COUNT(*) FROM storage_usage_breakdowns breakdown
    INNER JOIN organization ON organization.id = breakdown.org_id
  ),
  'projectionFiles', (
    SELECT COALESCE(SUM(file_count), 0) FROM storage_usage_breakdowns breakdown
    INNER JOIN organization ON organization.id = breakdown.org_id
  ),
  'projectionBytes', (
    SELECT COALESCE(SUM(bytes), 0) FROM storage_usage_breakdowns breakdown
    INNER JOIN organization ON organization.id = breakdown.org_id
  ),
  'activeFiles', (
    SELECT COUNT(*) FROM matters
    WHERE status = 'active' AND dirtype = 0 AND purged_at IS NULL
  ),
  'activeFileBytes', (
    SELECT COALESCE(SUM(size), 0) FROM matters
    WHERE status = 'active' AND dirtype = 0 AND purged_at IS NULL
  ),
  'activeImages', (
    SELECT COUNT(*) FROM image_hostings
    WHERE status = 'active' AND purged_at IS NULL
  ),
  'activeImageBytes', (
    SELECT COALESCE(SUM(size), 0) FROM image_hostings
    WHERE status = 'active' AND purged_at IS NULL
  )
) AS summary
`.trim()

function parseOptions(argv: string[]): Options {
  const sqliteIndex = argv.indexOf('--sqlite')
  const d1Index = argv.indexOf('--d1')
  if ((sqliteIndex >= 0) === (d1Index >= 0)) usage()
  if (sqliteIndex >= 0) {
    const path = argv[sqliteIndex + 1]
    if (!path) usage()
    return { apply: argv.includes('--apply'), target: { kind: 'sqlite', path } }
  }
  const database = argv[d1Index + 1]
  if (!database) usage()
  const envIndex = argv.indexOf('--env')
  return {
    apply: argv.includes('--apply'),
    target: {
      kind: 'd1',
      database,
      remote: argv.includes('--remote'),
      env: envIndex >= 0 ? argv[envIndex + 1] : undefined,
    },
  }
}

function usage(): never {
  throw new Error(
    'Usage: pnpm storage:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
  )
}

function d1Args(target: Extract<Target, { kind: 'd1' }>): string[] {
  return [
    'exec',
    'wrangler',
    'd1',
    'execute',
    target.database,
    target.remote ? '--remote' : '--local',
    ...(target.env ? ['--env', target.env] : []),
  ]
}

function query(target: Target): string {
  if (target.kind === 'd1') {
    const output = execFileSync('pnpm', [...d1Args(target), '--command', SUMMARY_SQL, '--json'], {
      encoding: 'utf8',
    })
    const payload = JSON.parse(output) as Array<{ results?: Array<{ summary?: string }> }>
    const summary = payload.flatMap((entry) => entry.results ?? []).find((row) => row.summary)?.summary
    if (!summary) throw new Error('storage_usage_backfill_summary_missing')
    return summary
  }
  const db = new Database(target.path, { readonly: true })
  try {
    return (db.prepare(SUMMARY_SQL).get() as { summary: string }).summary
  } finally {
    db.close()
  }
}

function apply(target: Target, sql: string): void {
  if (target.kind === 'sqlite') {
    const db = new Database(target.path)
    try {
      db.exec(sql)
    } finally {
      db.close()
    }
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'zpan-storage-usage-backfill-'))
  const file = join(dir, 'backfill.sql')
  try {
    writeFileSync(file, `${sql}\n`)
    execFileSync('pnpm', [...d1Args(target), '--file', file], { stdio: 'inherit' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const before = JSON.parse(query(options.target)) as Summary
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', before }, null, 2))
  if (!options.apply) return
  apply(options.target, buildStorageUsageBackfillSql(Date.now()))
  const after = JSON.parse(query(options.target)) as Summary
  assertSummary(after)
  console.log(JSON.stringify({ mode: 'complete', before, after }, null, 2))
}

function assertSummary(summary: Summary): void {
  const expectedFiles = summary.activeFiles + summary.activeImages
  const expectedBytes = summary.activeFileBytes + summary.activeImageBytes
  if (
    summary.projectionRows !== summary.organizations * 8 ||
    summary.projectionFiles !== expectedFiles ||
    summary.projectionBytes !== expectedBytes
  ) {
    throw new Error(
      `storage_usage_backfill_validation_failed:${JSON.stringify({
        expectedRows: summary.organizations * 8,
        actualRows: summary.projectionRows,
        expectedFiles,
        actualFiles: summary.projectionFiles,
        expectedBytes,
        actualBytes: summary.projectionBytes,
      })}`,
    )
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
