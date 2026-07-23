import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'

type Target =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

interface Options {
  apply: boolean
  target: Target
}

export const STORAGE_ENABLED_STATUS_BACKFILL_SQL = `
UPDATE storages
SET
  enabled = CASE
    WHEN status IN ('disabled', 'inactive') THEN 0
    WHEN status = 'active' THEN 1
    ELSE enabled
  END,
  status = CASE WHEN status IN ('failed', 'cors') THEN 'unhealthy' ELSE 'unknown' END,
  status_reason = CASE
    WHEN status = 'cors' THEN 'cors'
    WHEN status = 'failed' THEN 'unknown'
    ELSE NULL
  END,
  status_checked_at = CASE WHEN status IN ('failed', 'cors') THEN status_checked_at ELSE NULL END
WHERE status IN ('active', 'disabled', 'inactive', 'untested', 'failed', 'cors');
`.trim()

const SUMMARY_SQL = `
SELECT json_object(
  'total', COUNT(*),
  'legacy', COALESCE(SUM(CASE WHEN status IN ('active', 'disabled', 'inactive', 'untested', 'failed', 'cors') THEN 1 ELSE 0 END), 0),
  'enabled', COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0),
  'disabled', COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0)
) AS summary
FROM storages;
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
    'Usage: pnpm storage-status:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
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

function executeD1(target: Extract<Target, { kind: 'd1' }>, sql: string, json = false): string {
  return execFileSync('pnpm', [...d1Args(target), '--command', sql, ...(json ? ['--json'] : [])], {
    encoding: 'utf8',
    stdio: json ? 'pipe' : 'inherit',
  }) as string
}

function summary(target: Target): Record<string, number> {
  if (target.kind === 'd1') {
    const payload = JSON.parse(executeD1(target, SUMMARY_SQL, true)) as Array<{
      results?: Array<{ summary?: string }>
    }>
    const value = payload.flatMap((entry) => entry.results ?? []).find((row) => row.summary)?.summary
    if (!value) throw new Error('storage_status_backfill_summary_missing')
    return JSON.parse(value) as Record<string, number>
  }
  const db = new Database(target.path, { readonly: true })
  try {
    return JSON.parse((db.prepare(SUMMARY_SQL).get() as { summary: string }).summary) as Record<string, number>
  } finally {
    db.close()
  }
}

function apply(target: Target): void {
  if (target.kind === 'd1') {
    executeD1(target, STORAGE_ENABLED_STATUS_BACKFILL_SQL)
    return
  }
  const db = new Database(target.path)
  try {
    db.exec(STORAGE_ENABLED_STATUS_BACKFILL_SQL)
  } finally {
    db.close()
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const before = summary(options.target)
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', before }, null, 2))
  if (!options.apply) return
  apply(options.target)
  const after = summary(options.target)
  if (after.legacy !== 0) throw new Error(`storage_status_backfill_failed:${JSON.stringify(after)}`)
  console.log(JSON.stringify({ mode: 'complete', before, after }, null, 2))
}

if (process.argv[1]?.endsWith('backfill-storage-enabled-status.ts')) main()
