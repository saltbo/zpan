import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildOAuthScopeBackfill,
  parseOAuthScopeBackfillOptions,
  runOAuthScopeBackfill,
} from '../../scripts/backfill-oauth-scopes'
import { AuthorizationScope } from '../../shared/authorization'
import { OAUTH_SCOPES } from '../../shared/oauth'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createScopeDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'zpan-oauth-backfill-'))
  tempDirs.push(dir)
  const path = join(dir, 'zpan.db')
  const db = new Database(path)
  db.exec(`
    CREATE TABLE oauthResource (id TEXT PRIMARY KEY, name TEXT NOT NULL, allowed_scopes TEXT, updated_at INTEGER);
    CREATE TABLE oauthClient (id TEXT PRIMARY KEY, scopes TEXT, updated_at INTEGER);
  `)
  return { db, path }
}

describe('buildOAuthScopeBackfill', () => {
  it('updates ZPan resources and upload clients without expanding read-only clients', () => {
    const changes = buildOAuthScopeBackfill(
      [
        {
          id: 'zpan-resource',
          name: 'ZPan API',
          allowedScopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
        {
          id: 'other-resource',
          name: 'Other API',
          allowedScopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
      ],
      [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
        {
          id: 'read-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        },
      ],
    )

    expect(changes).toEqual({
      resources: [{ id: 'zpan-resource', scopes: JSON.stringify(OAUTH_SCOPES) }],
      clients: [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE]),
        },
      ],
    })
  })

  it('is idempotent after the scopes are current', () => {
    const changes = buildOAuthScopeBackfill(
      [{ id: 'zpan-resource', name: 'ZPan API', allowedScopes: JSON.stringify(OAUTH_SCOPES) }],
      [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE]),
        },
      ],
    )

    expect(changes).toEqual({ resources: [], clients: [] })
  })

  it('rejects malformed client scope documents', () => {
    expect(() => buildOAuthScopeBackfill([], [{ id: 'bad', scopes: '{' }])).toThrow(SyntaxError)
    expect(() => buildOAuthScopeBackfill([], [{ id: 'bad', scopes: '["objects:create", 1]' }])).toThrow(
      'invalid_oauth_client_scopes',
    )
    expect(buildOAuthScopeBackfill([], [{ id: 'empty', scopes: null }])).toEqual({ resources: [], clients: [] })
  })

  it('parses sqlite and D1 targets and rejects ambiguous invocations', () => {
    expect(parseOAuthScopeBackfillOptions(['--sqlite', '/tmp/zpan.db', '--apply'])).toEqual({
      apply: true,
      target: { kind: 'sqlite', path: '/tmp/zpan.db' },
    })
    expect(parseOAuthScopeBackfillOptions(['--d1', 'zpan-db', '--remote', '--env', 'staging'])).toEqual({
      apply: false,
      target: { kind: 'd1', database: 'zpan-db', remote: true, env: 'staging' },
    })
    expect(() => parseOAuthScopeBackfillOptions([])).toThrow('Usage:')
    expect(() => parseOAuthScopeBackfillOptions(['--sqlite', 'a', '--d1', 'b'])).toThrow('Usage:')
    expect(() => parseOAuthScopeBackfillOptions(['--sqlite'])).toThrow('Usage:')
    expect(() => parseOAuthScopeBackfillOptions(['--d1'])).toThrow('Usage:')
  })

  it('dry-runs and applies the SQLite backfill end to end', () => {
    const { db, path } = createScopeDatabase()
    db.prepare('INSERT INTO oauthResource (id, name, allowed_scopes) VALUES (?, ?, ?)').run(
      'zpan-resource',
      'ZPan API',
      JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
    )
    db.prepare('INSERT INTO oauthClient (id, scopes) VALUES (?, ?)').run(
      'upload-client',
      JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
    )
    db.close()
    const logs: string[] = []

    runOAuthScopeBackfill(['--sqlite', path], (message) => logs.push(message))
    expect(JSON.parse(logs[0])).toEqual({ mode: 'dry-run', resources: 1, clients: 1 })

    runOAuthScopeBackfill(['--sqlite', path, '--apply'], (message) => logs.push(message))
    const after = new Database(path, { readonly: true })
    expect(after.prepare('SELECT allowed_scopes FROM oauthResource WHERE id = ?').pluck().get('zpan-resource')).toBe(
      JSON.stringify(OAUTH_SCOPES),
    )
    expect(after.prepare('SELECT scopes FROM oauthClient WHERE id = ?').pluck().get('upload-client')).toBe(
      JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE]),
    )
    after.close()
    expect(JSON.parse(logs[1])).toEqual({ mode: 'apply', resources: 1, clients: 1 })
  })

  it('reads and applies a remote D1 backfill with escaped identifiers', () => {
    const resourceScopes = JSON.stringify(OAUTH_SCOPES)
    const clientScopes = JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE])
    const execute = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify([{ results: [{ id: "resource'1", name: 'ZPan API', allowedScopes: '[]' }] }]))
      .mockReturnValueOnce(
        JSON.stringify([
          { results: [{ id: 'client-1', scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]) }] },
        ]),
      )
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValueOnce(
        JSON.stringify([{ results: [{ id: "resource'1", name: 'ZPan API', allowedScopes: resourceScopes }] }]),
      )
      .mockReturnValueOnce(JSON.stringify([{ results: [{ id: 'client-1', scopes: clientScopes }] }]))

    runOAuthScopeBackfill(['--d1', 'zpan-db', '--remote', '--env', 'production', '--apply'], () => {}, execute)

    expect(execute).toHaveBeenCalledTimes(6)
    expect(execute.mock.calls[0]?.[0]).toEqual({
      kind: 'd1',
      database: 'zpan-db',
      remote: true,
      env: 'production',
    })
    expect(execute.mock.calls[0]?.[2]).toBe(true)
    expect(execute.mock.calls[2]?.[1]).toContain("resource''1")
  })
})
