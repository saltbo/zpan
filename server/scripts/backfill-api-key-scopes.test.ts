import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apiKeyScopeBackfillD1Args,
  applyApiKeyScopeBackfill,
  backfillApiKeyScopePermissionsRows,
  listApiKeyScopeBackfillRows,
  parseApiKeyScopeBackfillOptions,
  runApiKeyScopeBackfill,
  sqlString,
} from '../../scripts/backfill-api-key-scopes'

describe('API key scope backfill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('node:child_process')
  })

  async function importWithChildProcessMock(
    execFileSync: (command: string, args: string[], options: { encoding: string; stdio: 'pipe' | 'inherit' }) => string,
  ) {
    vi.doMock('node:child_process', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:child_process')>()
      const execFileSyncMock = vi.fn(execFileSync)
      return {
        ...actual,
        execFileSync: execFileSyncMock,
        default: {
          ...actual,
          execFileSync: execFileSyncMock,
        },
      }
    })
    return import('../../scripts/backfill-api-key-scopes')
  }

  it('converts legacy permissions and can be rerun', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE apikey (
        id TEXT PRIMARY KEY,
        permissions TEXT
      );
      INSERT INTO apikey (id, permissions) VALUES
        ('ihost', '{"ihost":["upload"]}'),
        ('webdav', '{"webdav":["read","write"]}'),
        ('remote', '{"remoteDownload":["read","create","cancel"]}'),
        ('canonical', '{"download-tasks":["read"]}'),
        ('empty', NULL);
    `)

    const rows = db.prepare('SELECT id, permissions FROM apikey ORDER BY id').all() as Array<{
      id: string
      permissions: string | null
    }>
    const changes = backfillApiKeyScopePermissionsRows(rows)
    const update = db.prepare('UPDATE apikey SET permissions = ? WHERE id = ?')
    for (const change of changes) update.run(change.after, change.id)

    expect(
      backfillApiKeyScopePermissionsRows(db.prepare('SELECT id, permissions FROM apikey').all() as typeof rows),
    ).toEqual([])
    expect(db.prepare('SELECT permissions FROM apikey WHERE id = ?').get('ihost')).toEqual({
      permissions: '{"images":["upload"]}',
    })
    expect(db.prepare('SELECT permissions FROM apikey WHERE id = ?').get('webdav')).toEqual({
      permissions: '{"objects":["create","delete","move","read","update"]}',
    })
    expect(db.prepare('SELECT permissions FROM apikey WHERE id = ?').get('remote')).toEqual({
      permissions: '{"download-tasks":["cancel","create","read"]}',
    })
    expect(db.prepare('SELECT permissions FROM apikey WHERE id = ?').get('canonical')).toEqual({
      permissions: '{"download-tasks":["read"]}',
    })
    db.close()
  })

  it('ignores invalid and unchanged permission payloads', () => {
    expect(
      backfillApiKeyScopePermissionsRows([
        { id: 'null', permissions: null },
        { id: 'empty', permissions: '' },
        { id: 'invalid-json', permissions: '{' },
        { id: 'array-json', permissions: '["webdav"]' },
        { id: 'non-array-actions', permissions: '{"webdav":"write"}' },
        { id: 'non-string-action', permissions: '{"webdav":["read",1]}' },
        { id: 'duplicate-canonical', permissions: '{"objects":["read","read"]}' },
      ]),
    ).toEqual([
      {
        id: 'non-array-actions',
        before: '{"webdav":"write"}',
        after: '{}',
      },
      {
        id: 'non-string-action',
        before: '{"webdav":["read",1]}',
        after: '{"objects":["read"]}',
      },
    ])
  })

  it('parses sqlite and d1 options', () => {
    expect(parseApiKeyScopeBackfillOptions(['--sqlite', '/tmp/zpan.db'])).toEqual({
      apply: false,
      target: { kind: 'sqlite', path: '/tmp/zpan.db' },
    })
    expect(parseApiKeyScopeBackfillOptions(['--apply', '--d1', 'zpan-db', '--remote', '--env', 'staging'])).toEqual({
      apply: true,
      target: { kind: 'd1', database: 'zpan-db', remote: true, env: 'staging' },
    })
  })

  it('rejects invalid option combinations', () => {
    expect(() => parseApiKeyScopeBackfillOptions([])).toThrow(
      'Usage: pnpm api-key-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
    )
    expect(() => parseApiKeyScopeBackfillOptions(['--sqlite', '/tmp/zpan.db', '--d1', 'zpan-db'])).toThrow(
      'Usage: pnpm api-key-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
    )
    expect(() => parseApiKeyScopeBackfillOptions(['--sqlite'])).toThrow(
      'Usage: pnpm api-key-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
    )
    expect(() => parseApiKeyScopeBackfillOptions(['--d1'])).toThrow(
      'Usage: pnpm api-key-scopes:backfill -- (--sqlite <path> | --d1 <database> [--remote] [--env <name>]) [--apply]',
    )
  })

  it('builds d1 arguments and escapes sql strings', () => {
    expect(apiKeyScopeBackfillD1Args({ kind: 'd1', database: 'zpan-db', remote: true, env: 'prod' })).toEqual([
      'exec',
      'wrangler',
      'd1',
      'execute',
      'zpan-db',
      '--remote',
      '--env',
      'prod',
    ])
    expect(apiKeyScopeBackfillD1Args({ kind: 'd1', database: 'zpan-db', remote: false })).toEqual([
      'exec',
      'wrangler',
      'd1',
      'execute',
      'zpan-db',
      '--local',
    ])
    expect(sqlString("key ' one")).toBe("'key '' one'")
  })

  it('lists and applies sqlite changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpan-api-key-backfill-'))

    try {
      const path = join(dir, 'db.sqlite')
      const db = new Database(path)
      db.exec(`
        CREATE TABLE apikey (
          id TEXT PRIMARY KEY,
          permissions TEXT
        );
        INSERT INTO apikey (id, permissions) VALUES
          ('legacy', '{"webdav":["write"]}'),
          ('canonical', '{"objects":["read"]}');
      `)
      db.close()

      const target = { kind: 'sqlite' as const, path }
      const changes = backfillApiKeyScopePermissionsRows(listApiKeyScopeBackfillRows(target))

      expect(changes).toEqual([
        {
          id: 'legacy',
          before: '{"webdav":["write"]}',
          after: '{"objects":["create","delete","move","update"]}',
        },
      ])

      applyApiKeyScopeBackfill(target, changes)

      expect(backfillApiKeyScopePermissionsRows(listApiKeyScopeBackfillRows(target))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists d1 rows from wrangler JSON output', () => {
    return importWithChildProcessMock((command, args, options) => {
      expect(command).toBe('pnpm')
      expect(args).toEqual([
        'exec',
        'wrangler',
        'd1',
        'execute',
        'zpan-db',
        '--remote',
        '--env',
        'staging',
        '--command',
        'SELECT id, permissions FROM apikey;',
        '--json',
      ])
      expect(options).toEqual({ encoding: 'utf8', stdio: 'pipe' })
      return JSON.stringify([
        { results: [{ id: 'legacy', permissions: '{"ihost":["upload"]}' }] },
        { results: [{ id: 'canonical', permissions: '{"images":["upload"]}' }] },
      ])
    }).then((mockedModule) => {
      expect(
        mockedModule.listApiKeyScopeBackfillRows({ kind: 'd1', database: 'zpan-db', remote: true, env: 'staging' }),
      ).toEqual([
        { id: 'legacy', permissions: '{"ihost":["upload"]}' },
        { id: 'canonical', permissions: '{"images":["upload"]}' },
      ])
    })
  })

  it('runs dry-run and apply modes against sqlite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zpan-api-key-backfill-run-'))

    try {
      const path = join(dir, 'db.sqlite')
      const db = new Database(path)
      db.exec(`
        CREATE TABLE apikey (
          id TEXT PRIMARY KEY,
          permissions TEXT
        );
        INSERT INTO apikey (id, permissions) VALUES
          ('legacy', '{"ihost":["upload"]}');
      `)
      db.close()

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const target = { kind: 'sqlite' as const, path }

      runApiKeyScopeBackfill({ apply: false, target })
      expect(log).toHaveBeenLastCalledWith(JSON.stringify({ mode: 'dry-run', changed: 1 }, null, 2))
      expect(backfillApiKeyScopePermissionsRows(listApiKeyScopeBackfillRows(target))).toHaveLength(1)

      runApiKeyScopeBackfill({ apply: true, target })
      expect(log).toHaveBeenNthCalledWith(2, JSON.stringify({ mode: 'apply', changed: 1 }, null, 2))
      expect(log).toHaveBeenNthCalledWith(3, JSON.stringify({ mode: 'complete', changed: 1 }, null, 2))
      expect(backfillApiKeyScopePermissionsRows(listApiKeyScopeBackfillRows(target))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails apply mode when d1 rows still need backfill after update', () => {
    return importWithChildProcessMock((_, args, options) => {
      const sql = args[args.indexOf('--command') + 1]

      if (sql.startsWith('SELECT')) {
        expect(options).toEqual({ encoding: 'utf8', stdio: 'pipe' })
        return JSON.stringify([{ results: [{ id: 'legacy', permissions: '{"ihost":["upload"]}' }] }])
      }

      expect(options).toEqual({ encoding: 'utf8', stdio: 'inherit' })
      return ''
    }).then((mockedModule) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

      expect(() =>
        mockedModule.runApiKeyScopeBackfill({
          apply: true,
          target: { kind: 'd1', database: 'zpan-db', remote: false },
        }),
      ).toThrow('api_key_scope_backfill_failed:1')
      expect(log).toHaveBeenCalledWith(JSON.stringify({ mode: 'apply', changed: 1 }, null, 2))
    })
  })
})
