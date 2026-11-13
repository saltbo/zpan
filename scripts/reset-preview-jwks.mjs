// Staging-only recovery for an undecryptable better-auth JWKS on the shared
// Preview D1 (see docs/deploy/worker-previews.md and #607/#609).
//
// Dry-run by default: lists the jwks rows and which secret version encrypted
// each one. With --confirm it writes a local backup of the selected rows and
// then deletes them; better-auth creates a fresh key on the next token request.
//
// The script refuses to run unless the D1 target is the Preview database
// declared in both wrangler.preview-migrations.json and wrangler.toml
// [[previews.d1_databases]], and is distinct from the production database.

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREVIEW_BINDING = 'PREVIEW_DB'
export const PREVIEW_DATABASE_NAME = 'zpan-db-staging'
export const DEFAULT_CONFIG = 'wrangler.preview-migrations.json'
export const DEFAULT_BACKUP_DIR = '.local/preview-jwks-backups'

const ENVELOPE_PREFIX = '$ba$'
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const USAGE = `Usage: pnpm reset:preview-jwks [--id <jwks-id> ...] [--all] [--confirm]

Lists, backs up, and deletes better-auth JWKS rows on the shared Preview
(staging) D1 only. Never use it against production.

Options:
  --id <id>          Select a jwks row to delete (repeatable).
  --all              Select every jwks row.
  --confirm          Actually back up and delete the selected rows.
                     Without it the script only prints what it would do.
  --config <file>    Wrangler config for the Preview D1 (default: ${DEFAULT_CONFIG}).
  --backup-dir <dir> Where to write the backup (default: ${DEFAULT_BACKUP_DIR}).
  -h, --help         Show this help.

Environment:
  WRANGLER_COMMAND   Command used to run wrangler (default: "pnpm exec wrangler").`

export function parseArgs(argv) {
  const options = {
    ids: [],
    all: false,
    confirm: false,
    help: false,
    config: DEFAULT_CONFIG,
    backupDir: DEFAULT_BACKUP_DIR,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} requires a value`)
      return next
    }
    if (arg === '--id') options.ids.push(value())
    else if (arg === '--all') options.all = true
    else if (arg === '--confirm') options.confirm = true
    else if (arg === '--dry-run') options.confirm = false
    else if (arg === '--config') options.config = value()
    else if (arg === '--backup-dir') options.backupDir = value()
    else if (arg === '-h' || arg === '--help') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.all && options.ids.length > 0) throw new Error('Use either --all or --id, not both')
  for (const id of options.ids) {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid jwks id: ${JSON.stringify(id)}`)
  }
  if (options.confirm && !options.all && options.ids.length === 0) {
    throw new Error('--confirm needs a selection: pass --id <id> (repeatable) or --all')
  }
  return options
}

/**
 * Minimal reader for the `[[d1_databases]]` and `[[previews.d1_databases]]`
 * tables in wrangler.toml. Only flat `key = "string"` pairs are needed.
 */
export function readTomlD1Databases(toml) {
  const result = { production: [], previews: [] }
  let current = null
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      if (line === '[[d1_databases]]') {
        current = {}
        result.production.push(current)
      } else if (line === '[[previews.d1_databases]]') {
        current = {}
        result.previews.push(current)
      } else {
        current = null
      }
      continue
    }
    const match = /^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/.exec(line)
    if (current && match) current[match[1]] = match[2]
  }
  return result
}

/**
 * Validates that the wrangler config passed to `d1 execute` targets the Preview
 * database and nothing else. Throws with a reason when it does not.
 */
export function assertPreviewTarget(config, toml) {
  const databases = Array.isArray(config?.d1_databases) ? config.d1_databases : []
  if (databases.length !== 1) {
    throw new Error(`Refusing: expected exactly one D1 database in the config, found ${databases.length}`)
  }
  const [target] = databases
  if (target.binding !== PREVIEW_BINDING) {
    throw new Error(`Refusing: D1 binding must be ${PREVIEW_BINDING}, got ${JSON.stringify(target.binding)}`)
  }
  if (target.database_name !== PREVIEW_DATABASE_NAME) {
    throw new Error(
      `Refusing: database_name must be ${PREVIEW_DATABASE_NAME}, got ${JSON.stringify(target.database_name)}`,
    )
  }
  if (!target.database_id) throw new Error('Refusing: the Preview D1 entry has no database_id')

  const { production, previews } = readTomlD1Databases(toml)
  const preview = previews.find((db) => db.binding === 'DB')
  if (!preview) throw new Error('Refusing: wrangler.toml has no [[previews.d1_databases]] DB binding')
  if (preview.database_id !== target.database_id || preview.database_name !== target.database_name) {
    throw new Error('Refusing: the config does not match wrangler.toml [[previews.d1_databases]]')
  }
  for (const prod of production) {
    if (prod.database_id === target.database_id || prod.database_name === target.database_name) {
      throw new Error(`Refusing: ${target.database_name} is also a production D1 database in wrangler.toml`)
    }
  }
  return target
}

/** Describes which secret encrypted a stored private key, without exposing it. */
export function describeEncryption(privateKey) {
  if (typeof privateKey !== 'string' || privateKey.length === 0) return 'empty'
  if (privateKey.startsWith(ENVELOPE_PREFIX)) {
    const end = privateKey.indexOf('$', ENVELOPE_PREFIX.length)
    const version = privateKey.slice(ENVELOPE_PREFIX.length, end)
    return end !== -1 && /^\d+$/.test(version) ? `BETTER_AUTH_SECRETS v${version}` : 'malformed envelope'
  }
  if (privateKey.startsWith('{')) return 'plaintext'
  return 'legacy BETTER_AUTH_SECRET'
}

export function selectRows(rows, options) {
  if (options.all) return rows
  const byId = new Map(rows.map((row) => [row.id, row]))
  const missing = options.ids.filter((id) => !byId.has(id))
  if (missing.length > 0) throw new Error(`No jwks row with id: ${missing.join(', ')}`)
  return options.ids.map((id) => byId.get(id))
}

export function buildDeleteSql(ids) {
  if (ids.length === 0) throw new Error('Nothing to delete')
  for (const id of ids) {
    if (!ID_PATTERN.test(id)) throw new Error(`Invalid jwks id: ${JSON.stringify(id)}`)
  }
  return `DELETE FROM jwks WHERE id IN (${ids.map((id) => `'${id}'`).join(', ')});`
}

export function buildWranglerArgs(configFile, sql) {
  return ['d1', 'execute', PREVIEW_BINDING, '--remote', '--config', configFile, '--json', '--command', sql]
}

export function parseWranglerJson(output) {
  const parsed = JSON.parse(output)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  if (!first || first.success === false) throw new Error('wrangler d1 execute did not succeed')
  return first.results ?? []
}

export function formatRows(rows) {
  if (rows.length === 0) return '  (no jwks rows)'
  return rows
    .map((row) => {
      const created = row.created_at ? new Date(Number(row.created_at)).toISOString() : '-'
      const expires = row.expires_at ? new Date(Number(row.expires_at)).toISOString() : '-'
      return `  ${row.id}  alg=${row.alg ?? '-'}  created=${created}  expires=${expires}  encrypted-with=${describeEncryption(row.private_key)}`
    })
    .join('\n')
}

export function backupFileName(now) {
  return `jwks-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

/**
 * Runs the reset. `deps` is injected so the flow can be tested without wrangler.
 * Returns a summary of what was (or would be) deleted.
 */
export function run(options, deps) {
  const { readFile, writeFile, execWrangler, log, now } = deps
  const target = assertPreviewTarget(JSON.parse(readFile(options.config)), readFile('wrangler.toml'))
  log(`Target: ${target.binding} -> ${target.database_name} (${target.database_id}) [remote]`)

  const query = (sql) => parseWranglerJson(execWrangler(buildWranglerArgs(options.config, sql)))
  const rows = query('SELECT id, public_key, private_key, alg, crv, created_at, expires_at FROM jwks ORDER BY created_at;')
  log(`jwks rows:\n${formatRows(rows)}`)

  if (!options.all && options.ids.length === 0) {
    log('\nDry run. Select rows with --id <id> (or --all) and add --confirm to back up and delete them.')
    return { deleted: [], backupFile: null }
  }

  const selected = selectRows(rows, options)
  const ids = selected.map((row) => row.id)
  if (ids.length === 0) {
    log('\nNothing to delete.')
    return { deleted: [], backupFile: null }
  }
  if (!options.confirm) {
    log(`\nDry run: would back up and delete ${ids.length} row(s): ${ids.join(', ')}`)
    log('Re-run with --confirm to do it.')
    return { deleted: [], backupFile: null }
  }

  const timestamp = now()
  const backupFile = path.join(options.backupDir, backupFileName(timestamp))
  const backup = {
    database: target.database_name,
    databaseId: target.database_id,
    createdAt: timestamp.toISOString(),
    rows: selected,
  }
  writeFile(backupFile, `${JSON.stringify(backup, null, 2)}\n`)
  log(`\nBacked up ${ids.length} row(s) to ${backupFile} (contains encrypted private keys; keep it private).`)

  query(buildDeleteSql(ids))
  const remaining = query('SELECT id FROM jwks;').map((row) => row.id)
  const notDeleted = ids.filter((id) => remaining.includes(id))
  if (notDeleted.length > 0) throw new Error(`Rows still present after delete: ${notDeleted.join(', ')}`)
  log(`Deleted ${ids.length} row(s). better-auth creates a new key on the next token request.`)
  return { deleted: ids, backupFile }
}

/* v8 ignore start -- CLI wiring; the flow above is covered with injected deps. */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }
  const [command, ...prefix] = (process.env.WRANGLER_COMMAND || 'pnpm exec wrangler').split(/\s+/).filter(Boolean)
  run(options, {
    readFile: (file) => readFileSync(file, 'utf8'),
    writeFile: (file, content) => {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, content, { mode: 0o600 })
      chmodSync(file, 0o600)
    },
    execWrangler: (args) =>
      execFileSync(command, [...prefix, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }),
    log: (message) => console.log(message),
    now: () => new Date(),
  })
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
/* v8 ignore stop */
