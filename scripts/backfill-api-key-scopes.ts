#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import type { ApiKeyPermissions } from '../shared/authorization'

export type ApiKeyScopeBackfillTarget =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

export interface ApiKeyScopeBackfillOptions {
  apply: boolean
  target: ApiKeyScopeBackfillTarget
}

interface PermissionRow {
  id: string
  permissions: string | null
}

export interface ApiKeyScopeBackfillResult {
  id: string
  before: string | null
  after: string
}

const LEGACY_SCOPE_MAP: Record<string, Record<string, string[]>> = {
  ihost: {
    upload: ['images:upload'],
  },
  webdav: {
    read: ['objects:read'],
    write: ['objects:create', 'objects:update', 'objects:delete', 'objects:move'],
  },
  remoteDownload: {
    read: ['download-tasks:read'],
    create: ['download-tasks:create'],
    cancel: ['download-tasks:cancel'],
  },
}

export function backfillApiKeyScopePermissionsRows(rows: PermissionRow[]): ApiKeyScopeBackfillResult[] {
  return rows.flatMap((row) => {
    const before = parsePermissions(row.permissions)
    if (!before) return []
    const after = canonicalizePermissions(before)
    const beforeJson = stableJson(before)
    const afterJson = stableJson(after)
    return beforeJson === afterJson ? [] : [{ id: row.id, before: row.permissions, after: afterJson }]
  })
}

function canonicalizePermissions(input: ApiKeyPermissions): ApiKeyPermissions {
  const scopes = new Set<string>()
  for (const [resource, actions] of Object.entries(input)) {
    if (!Array.isArray(actions)) continue
    for (const action of actions) {
      if (typeof action !== 'string') continue
      const legacyScopes = LEGACY_SCOPE_MAP[resource]?.[action]
      if (legacyScopes) {
        for (const scope of legacyScopes) scopes.add(scope)
        continue
      }
      scopes.add(`${resource}:${action}`)
    }
  }
  const output: ApiKeyPermissions = {}
  for (const scope of [...scopes].sort()) {
    const separator = scope.indexOf(':')
    if (separator <= 0) continue
    const resource = scope.slice(0, separator)
    const action = scope.slice(separator + 1)
    output[resource] = [...(output[resource] ?? []), action]
  }
  return output
}

function parsePermissions(value: string | null): ApiKeyPermissions | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ApiKeyPermissions) : null
  } catch {
    return null
  }
}

function stableJson(permissions: ApiKeyPermissions): string {
  const sorted: ApiKeyPermissions = {}
  for (const resource of Object.keys(permissions).sort()) {
    sorted[resource] = [...new Set(permissions[resource])].sort()
  }
  return JSON.stringify(sorted)
}

export function parseApiKeyScopeBackfillOptions(argv: string[]): ApiKeyScopeBackfillOptions {
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
  throw new Error('Usage: pnpm api-key-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]')
}

export function apiKeyScopeBackfillD1Args(target: Extract<ApiKeyScopeBackfillTarget, { kind: 'd1' }>): string[] {
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

function executeD1(target: Extract<ApiKeyScopeBackfillTarget, { kind: 'd1' }>, sql: string, json = false): string {
  return execFileSync('pnpm', [...apiKeyScopeBackfillD1Args(target), '--command', sql, ...(json ? ['--json'] : [])], {
    encoding: 'utf8',
    stdio: json ? 'pipe' : 'inherit',
  }) as string
}

export function listApiKeyScopeBackfillRows(target: ApiKeyScopeBackfillTarget): PermissionRow[] {
  if (target.kind === 'd1') {
    const payload = JSON.parse(executeD1(target, 'SELECT id, permissions FROM apikey;', true)) as Array<{
      results?: PermissionRow[]
    }>
    return payload.flatMap((entry) => entry.results ?? [])
  }
  const db = new Database(target.path, { readonly: true })
  try {
    return db.prepare('SELECT id, permissions FROM apikey').all() as PermissionRow[]
  } finally {
    db.close()
  }
}

export function applyApiKeyScopeBackfill(
  target: ApiKeyScopeBackfillTarget,
  changes: ApiKeyScopeBackfillResult[],
): void {
  /* v8 ignore next 6 -- D1 execution is covered by argument/SQL formatting tests; integration requires Wrangler. */
  if (target.kind === 'd1') {
    for (const change of changes) {
      executeD1(target, `UPDATE apikey SET permissions = ${sqlString(change.after)} WHERE id = ${sqlString(change.id)};`)
    }
    return
  }
  const db = new Database(target.path)
  try {
    const update = db.prepare('UPDATE apikey SET permissions = ? WHERE id = ?')
    const tx = db.transaction((items: ApiKeyScopeBackfillResult[]) => {
      for (const item of items) update.run(item.after, item.id)
    })
    tx(changes)
  } finally {
    db.close()
  }
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function runApiKeyScopeBackfill(options: ApiKeyScopeBackfillOptions): void {
  const before = listApiKeyScopeBackfillRows(options.target)
  const changes = backfillApiKeyScopePermissionsRows(before)
  console.log(JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', changed: changes.length }, null, 2))
  if (!options.apply) return
  applyApiKeyScopeBackfill(options.target, changes)
  const remaining = backfillApiKeyScopePermissionsRows(listApiKeyScopeBackfillRows(options.target))
  if (remaining.length > 0) throw new Error(`api_key_scope_backfill_failed:${remaining.length}`)
  console.log(JSON.stringify({ mode: 'complete', changed: changes.length }, null, 2))
}

function main(): void {
  runApiKeyScopeBackfill(parseApiKeyScopeBackfillOptions(process.argv.slice(2)))
}

if (process.argv[1]?.endsWith('backfill-api-key-scopes.ts')) main()
