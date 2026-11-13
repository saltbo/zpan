import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertPreviewTarget,
  backupFileName,
  buildDeleteSql,
  buildWranglerArgs,
  describeEncryption,
  formatRows,
  parseArgs,
  parseWranglerJson,
  readTomlD1Databases,
  run,
  selectRows,
} from './reset-preview-jwks.mjs'

const TOML = `
name = "zpan"

[[d1_databases]]
binding = "DB"
database_name = "zpan-db"
database_id = "prod-id"

[[kv_namespaces]]
binding = "CACHE_KV"
id = "kv"

[previews]
[[previews.d1_databases]]
binding = "DB" # staging
database_name = "zpan-db-staging"
database_id = "staging-id"
`

const previewConfig = (overrides = {}) => ({
  d1_databases: [{ binding: 'PREVIEW_DB', database_name: 'zpan-db-staging', database_id: 'staging-id', ...overrides }],
})

describe('parseArgs', () => {
  it('defaults to a dry run with no selection', () => {
    expect(parseArgs([])).toMatchObject({ ids: [], all: false, confirm: false, help: false })
  })

  it('collects repeated ids, confirm, config and backup dir', () => {
    expect(
      parseArgs(['--id', 'a', '--id', 'b', '--confirm', '--config', 'x.json', '--backup-dir', 'out']),
    ).toMatchObject({ ids: ['a', 'b'], confirm: true, config: 'x.json', backupDir: 'out' })
    expect(parseArgs(['--dry-run']).confirm).toBe(false)
    expect(parseArgs(['-h']).help).toBe(true)
  })

  it('requires an explicit selection to confirm', () => {
    expect(() => parseArgs(['--confirm'])).toThrow(/needs a selection/)
    expect(parseArgs(['--all', '--confirm'])).toMatchObject({ all: true, confirm: true })
  })

  it('rejects unsafe or conflicting input', () => {
    expect(() => parseArgs(['--id', "x'; DROP TABLE user; --"])).toThrow(/Invalid jwks id/)
    expect(() => parseArgs(['--all', '--id', 'a'])).toThrow(/either --all or --id/)
    expect(() => parseArgs(['--id'])).toThrow(/requires a value/)
    expect(() => parseArgs(['--id', '--confirm'])).toThrow(/requires a value/)
    expect(() => parseArgs(['--remote-prod'])).toThrow(/Unknown argument/)
  })
})

describe('readTomlD1Databases', () => {
  it('separates production and preview D1 tables', () => {
    expect(readTomlD1Databases(TOML)).toEqual({
      production: [{ binding: 'DB', database_name: 'zpan-db', database_id: 'prod-id' }],
      previews: [{ binding: 'DB', database_name: 'zpan-db-staging', database_id: 'staging-id' }],
    })
  })
})

describe('assertPreviewTarget', () => {
  it('accepts the Preview D1', () => {
    expect(assertPreviewTarget(previewConfig(), TOML)).toMatchObject({ database_id: 'staging-id' })
  })

  it('refuses non-preview bindings and names', () => {
    expect(() => assertPreviewTarget(previewConfig({ binding: 'DB' }), TOML)).toThrow(/binding must be PREVIEW_DB/)
    expect(() => assertPreviewTarget(previewConfig({ database_name: 'zpan-db' }), TOML)).toThrow(/database_name/)
    expect(() => assertPreviewTarget(previewConfig({ database_id: '' }), TOML)).toThrow(/no database_id/)
  })

  it('refuses configs with zero or multiple databases', () => {
    expect(() => assertPreviewTarget({}, TOML)).toThrow(/found 0/)
    const two = previewConfig()
    two.d1_databases.push({ ...two.d1_databases[0] })
    expect(() => assertPreviewTarget(two, TOML)).toThrow(/found 2/)
  })

  it('refuses a database id that is not the Preview D1 in wrangler.toml', () => {
    expect(() => assertPreviewTarget(previewConfig({ database_id: 'prod-id' }), TOML)).toThrow(
      /does not match wrangler.toml/,
    )
    expect(() => assertPreviewTarget(previewConfig(), TOML.split('[previews]')[0])).toThrow(/no \[\[previews/)
  })

  it('refuses when the preview database is also a production database', () => {
    const toml = TOML.replace('database_id = "prod-id"', 'database_id = "staging-id"')
    expect(() => assertPreviewTarget(previewConfig(), toml)).toThrow(/also a production/)
  })

  it('accepts the repository configs', () => {
    const config = JSON.parse(readFileSync('wrangler.preview-migrations.json', 'utf8'))
    expect(() => assertPreviewTarget(config, readFileSync('wrangler.toml', 'utf8'))).not.toThrow()
  })
})

describe('describeEncryption', () => {
  it('reports the secret version without exposing the key', () => {
    expect(describeEncryption('$ba$2$abcdef')).toBe('BETTER_AUTH_SECRETS v2')
    expect(describeEncryption('$ba$x$abc')).toBe('malformed envelope')
    expect(describeEncryption('$ba$1')).toBe('malformed envelope')
    expect(describeEncryption('a1b2c3')).toBe('legacy BETTER_AUTH_SECRET')
    expect(describeEncryption('{"kty":"OKP"}')).toBe('plaintext')
    expect(describeEncryption('')).toBe('empty')
    expect(describeEncryption(undefined)).toBe('empty')
  })
})

describe('row helpers', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]

  it('selects all or explicit rows and rejects unknown ids', () => {
    expect(selectRows(rows, { all: true, ids: [] })).toBe(rows)
    expect(selectRows(rows, { all: false, ids: ['b'] })).toEqual([{ id: 'b' }])
    expect(() => selectRows(rows, { all: false, ids: ['c'] })).toThrow(/No jwks row with id: c/)
  })

  it('builds a delete restricted to validated ids', () => {
    expect(buildDeleteSql(['a', 'b-1'])).toBe("DELETE FROM jwks WHERE id IN ('a', 'b-1');")
    expect(() => buildDeleteSql([])).toThrow(/Nothing to delete/)
    expect(() => buildDeleteSql(["a'"])).toThrow(/Invalid jwks id/)
  })

  it('always targets the remote Preview binding', () => {
    expect(buildWranglerArgs('cfg.json', 'SELECT 1;')).toEqual([
      'd1',
      'execute',
      'PREVIEW_DB',
      '--remote',
      '--config',
      'cfg.json',
      '--json',
      '--command',
      'SELECT 1;',
    ])
  })

  it('parses wrangler JSON output', () => {
    expect(parseWranglerJson(JSON.stringify([{ success: true, results: [{ id: 'a' }] }]))).toEqual([{ id: 'a' }])
    expect(parseWranglerJson(JSON.stringify({ success: true }))).toEqual([])
    expect(() => parseWranglerJson(JSON.stringify([{ success: false }]))).toThrow(/did not succeed/)
    expect(() => parseWranglerJson('[]')).toThrow(/did not succeed/)
  })

  it('formats rows without the private key', () => {
    const text = formatRows([
      { id: 'a', alg: 'EdDSA', created_at: 0, expires_at: null, private_key: '$ba$1$secretcipher' },
      { id: 'b', private_key: 'deadbeef' },
    ])
    expect(text).toContain('a  alg=EdDSA')
    expect(text).toContain('encrypted-with=BETTER_AUTH_SECRETS v1')
    expect(text).toContain('b  alg=-  created=-  expires=-  encrypted-with=legacy BETTER_AUTH_SECRET')
    expect(text).not.toContain('secretcipher')
    expect(formatRows([])).toContain('no jwks rows')
  })

  it('names backups with a filesystem-safe timestamp', () => {
    expect(backupFileName(new Date('2026-11-12T01:02:03.456Z'))).toBe('jwks-2026-11-12T01-02-03-456Z.json')
  })
})

describe('run', () => {
  const stored = [
    { id: 'old', private_key: 'deadbeef', created_at: 1 },
    { id: 'new', private_key: '$ba$1$cafe', created_at: 2 },
  ]

  function fakeDeps({ remainingAfterDelete = ['new'], config = previewConfig() } = {}) {
    const calls = []
    const writes = []
    const logs = []
    let deleted = false
    const deps = {
      readFile: (file) => (file === 'wrangler.toml' ? TOML : JSON.stringify(config)),
      writeFile: (file, content) => writes.push({ file, content }),
      execWrangler: (args) => {
        calls.push(args)
        const sql = args.at(-1)
        if (sql.startsWith('DELETE')) {
          deleted = true
          return JSON.stringify([{ success: true, results: [] }])
        }
        if (sql === 'SELECT id FROM jwks;') {
          const ids = deleted ? remainingAfterDelete : stored.map((row) => row.id)
          return JSON.stringify([{ success: true, results: ids.map((id) => ({ id })) }])
        }
        return JSON.stringify([{ success: true, results: stored }])
      },
      log: (message) => logs.push(message),
      now: () => new Date('2026-11-12T00:00:00.000Z'),
    }
    return { deps, calls, writes, logs }
  }

  const opts = (overrides) => ({ ...parseArgs([]), ...overrides })

  it('refuses a non-preview target before calling wrangler', () => {
    const { deps, calls } = fakeDeps({ config: previewConfig({ binding: 'DB' }) })
    expect(() => run(opts(), deps)).toThrow(/Refusing/)
    expect(calls).toHaveLength(0)
  })

  it('lists rows and changes nothing without a selection', () => {
    const { deps, calls, writes, logs } = fakeDeps()
    expect(run(opts(), deps)).toEqual({ deleted: [], backupFile: null })
    expect(calls).toHaveLength(1)
    expect(calls[0].at(-1)).toMatch(/^SELECT/)
    expect(writes).toHaveLength(0)
    expect(logs.join('\n')).toContain('Dry run')
    expect(logs.join('\n')).not.toContain('cafe')
  })

  it('previews a selection without --confirm', () => {
    const { deps, calls, writes, logs } = fakeDeps()
    expect(run(opts({ ids: ['old'] }), deps).deleted).toEqual([])
    expect(calls.some((args) => args.at(-1).startsWith('DELETE'))).toBe(false)
    expect(writes).toHaveLength(0)
    expect(logs.join('\n')).toContain('would back up and delete 1 row(s): old')
  })

  it('backs up before deleting with --confirm', () => {
    const { deps, calls, writes } = fakeDeps()
    const result = run(opts({ ids: ['old'], confirm: true, backupDir: 'out' }), deps)
    expect(result).toEqual({ deleted: ['old'], backupFile: 'out/jwks-2026-11-12T00-00-00-000Z.json' })
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].content)).toMatchObject({
      database: 'zpan-db-staging',
      databaseId: 'staging-id',
      rows: [{ id: 'old', private_key: 'deadbeef' }],
    })
    const deleteIndex = calls.findIndex((args) => args.at(-1).startsWith('DELETE'))
    expect(calls[deleteIndex].at(-1)).toBe("DELETE FROM jwks WHERE id IN ('old');")
    expect(calls.every((args) => args.includes('--remote') && args[2] === 'PREVIEW_DB')).toBe(true)
  })

  it('fails when a deleted row is still present', () => {
    const { deps } = fakeDeps({ remainingAfterDelete: ['old', 'new'] })
    expect(() => run(opts({ ids: ['old'], confirm: true }), deps)).toThrow(/still present.*old/)
  })

  it('does nothing when --all matches no rows', () => {
    const { deps, calls, writes } = fakeDeps()
    deps.execWrangler = (args) => {
      calls.push(args)
      return JSON.stringify([{ success: true, results: [] }])
    }
    expect(run(opts({ all: true, confirm: true }), deps)).toEqual({ deleted: [], backupFile: null })
    expect(writes).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })

  it('refuses unknown ids before writing or deleting', () => {
    const { deps, calls, writes } = fakeDeps()
    expect(() => run(opts({ ids: ['missing'], confirm: true }), deps)).toThrow(/No jwks row/)
    expect(writes).toHaveLength(0)
    expect(calls).toHaveLength(1)
  })
})
