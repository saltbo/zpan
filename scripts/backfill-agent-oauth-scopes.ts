#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { AGENT_OAUTH_SCOPES } from '../shared/agent-oauth'
import { AuthorizationScope } from '../shared/authorization'

type Target =
  | { kind: 'sqlite'; path: string }
  | { kind: 'd1'; database: string; remote: boolean; env?: string }

interface Options {
  apply: boolean
  target: Target
}

interface OAuthResourceRow {
  id: string
  name: string
  allowedScopes: string | null
}

interface OAuthClientRow {
  id: string
  scopes: string | null
}

export interface AgentOAuthScopeBackfill {
  resources: Array<{ id: string; scopes: string }>
  clients: Array<{ id: string; scopes: string }>
}

export function buildAgentOAuthScopeBackfill(
  resources: OAuthResourceRow[],
  clients: OAuthClientRow[],
): AgentOAuthScopeBackfill {
  const resourceScopes = JSON.stringify(AGENT_OAUTH_SCOPES)
  return {
    resources: resources.flatMap((resource) =>
      resource.name === 'ZPan API' && resource.allowedScopes !== resourceScopes
        ? [{ id: resource.id, scopes: resourceScopes }]
        : [],
    ),
    clients: clients.flatMap((client) => {
      const scopes = parseScopes(client.scopes)
      if (!scopes.includes(AuthorizationScope.OBJECTS_CREATE) || scopes.includes(AuthorizationScope.QUOTA_PURCHASE)) {
        return []
      }
      return [{ id: client.id, scopes: JSON.stringify([...scopes, AuthorizationScope.QUOTA_PURCHASE]) }]
    }),
  }
}

function parseScopes(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((scope) => typeof scope !== 'string')) {
    throw new Error('invalid_oauth_client_scopes')
  }
  return parsed
}

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
    'Usage: pnpm agent-oauth-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
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

function d1Rows<T>(target: Extract<Target, { kind: 'd1' }>, sql: string): T[] {
  const payload = JSON.parse(executeD1(target, sql, true)) as Array<{ results?: T[] }>
  return payload.flatMap((entry) => entry.results ?? [])
}

function readRows(target: Target): { resources: OAuthResourceRow[]; clients: OAuthClientRow[] } {
  const resourceSql = 'SELECT id, name, allowed_scopes AS allowedScopes FROM oauthResource;'
  const clientSql = 'SELECT id, scopes FROM oauthClient;'
  if (target.kind === 'd1') {
    return {
      resources: d1Rows(target, resourceSql),
      clients: d1Rows(target, clientSql),
    }
  }
  const db = new Database(target.path, { readonly: true })
  try {
    return {
      resources: db.prepare(resourceSql).all() as OAuthResourceRow[],
      clients: db.prepare(clientSql).all() as OAuthClientRow[],
    }
  } finally {
    db.close()
  }
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function applyBackfill(target: Target, changes: AgentOAuthScopeBackfill): void {
  if (target.kind === 'd1') {
    for (const resource of changes.resources) {
      executeD1(
        target,
        `UPDATE oauthResource SET allowed_scopes = ${sqlString(resource.scopes)}, updated_at = cast(unixepoch('subsecond') * 1000 as integer) WHERE id = ${sqlString(resource.id)};`,
      )
    }
    for (const client of changes.clients) {
      executeD1(
        target,
        `UPDATE oauthClient SET scopes = ${sqlString(client.scopes)}, updated_at = cast(unixepoch('subsecond') * 1000 as integer) WHERE id = ${sqlString(client.id)};`,
      )
    }
    return
  }
  const db = new Database(target.path)
  try {
    const updateResource = db.prepare('UPDATE oauthResource SET allowed_scopes = ?, updated_at = ? WHERE id = ?')
    const updateClient = db.prepare('UPDATE oauthClient SET scopes = ?, updated_at = ? WHERE id = ?')
    const now = Date.now()
    db.transaction(() => {
      for (const resource of changes.resources) updateResource.run(resource.scopes, now, resource.id)
      for (const client of changes.clients) updateClient.run(client.scopes, now, client.id)
    })()
  } finally {
    db.close()
  }
}

function countChanges(changes: AgentOAuthScopeBackfill): number {
  return changes.resources.length + changes.clients.length
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const rows = readRows(options.target)
  const changes = buildAgentOAuthScopeBackfill(rows.resources, rows.clients)
  console.log(
    JSON.stringify(
      {
        mode: options.apply ? 'apply' : 'dry-run',
        resources: changes.resources.length,
        clients: changes.clients.length,
      },
      null,
      2,
    ),
  )
  if (!options.apply) return
  applyBackfill(options.target, changes)
  const after = readRows(options.target)
  const remaining = buildAgentOAuthScopeBackfill(after.resources, after.clients)
  if (countChanges(remaining) > 0) throw new Error(`agent_oauth_scope_backfill_failed:${countChanges(remaining)}`)
}

if (process.argv[1]?.endsWith('backfill-agent-oauth-scopes.ts')) main()
