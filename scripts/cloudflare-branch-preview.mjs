import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PREVIEW_DB_PREFIX = 'zpan-preview-'
export const PREVIEW_REVIEWER_EMAIL = 'reviewer@zpan.dev'
export const PREVIEW_REVIEWER_PASSWORD = 'zpan-staging-reviewer-2026'
export const DEFAULT_CONFIG_PATH = 'dist/zpan/wrangler.json'
export const DEFAULT_ENV = 'staging'

const args = process.argv.slice(2)

export function previewSlug(source, maxLength = 45) {
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  const base = normalized || 'branch'
  const safeBase = /^[a-z]/.test(base) ? base : `b-${base}`
  if (safeBase.length <= maxLength) return safeBase

  const hash = createHash('sha1').update(safeBase).digest('hex').slice(0, 8)
  return `${safeBase.slice(0, maxLength - hash.length - 1).replace(/-+$/g, '')}-${hash}`
}

export function previewDatabaseName(source) {
  const normalized = previewSlug(source, 45)
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8)
  const baseLength = 32 - PREVIEW_DB_PREFIX.length - hash.length - 1
  return `${PREVIEW_DB_PREFIX}${normalized.slice(0, baseLength).replace(/-+$/g, '')}-${hash}`
}

export function resolvePreviewContext(env = process.env) {
  const source =
    env.ZPAN_PREVIEW_NAME ||
    env.WORKERS_CI_BRANCH ||
    env.GITHUB_HEAD_REF ||
    env.GITHUB_REF_NAME ||
    env.BRANCH_NAME ||
    currentGitBranch()
  if (!source) throw new Error('A branch name is required to manage a preview database')
  if (source === 'main') throw new Error('Refusing to manage a preview database for main')
  const repository =
    env.ZPAN_PREVIEW_REPOSITORY || env.GITHUB_HEAD_REPOSITORY || env.GITHUB_REPOSITORY || currentGitRepository()
  if (!repository) throw new Error('A repository name is required to isolate a preview database')
  const slug = previewSlug(`${repository}-${source}`)
  const databaseName = env.ZPAN_PREVIEW_D1_DATABASE || previewDatabaseName(`${repository}:${source}`)
  assertPreviewDatabaseName(databaseName)
  return { source, repository, slug, databaseName }
}

export function assertPreviewDatabaseName(name) {
  if (!/^zpan-preview-[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
    throw new Error(`Refusing to manage non-preview D1 database: ${name}`)
  }
}

export function patchD1BindingConfig(rawConfig, databaseName, databaseId) {
  const bindingsToPatch = []

  const patchList = (bindings) => {
    if (!Array.isArray(bindings)) return
    for (const binding of bindings) {
      if (!binding || typeof binding !== 'object' || binding.binding !== 'DB') continue
      bindingsToPatch.push(binding)
    }
  }

  patchList(rawConfig.d1_databases)
  if (rawConfig.env && typeof rawConfig.env === 'object') {
    for (const envConfig of Object.values(rawConfig.env)) {
      if (envConfig && typeof envConfig === 'object') patchList(envConfig.d1_databases)
    }
  }

  if (bindingsToPatch.length !== 1) {
    throw new Error(`Expected exactly one D1 binding named DB, found ${bindingsToPatch.length}`)
  }
  bindingsToPatch[0].database_name = databaseName
  bindingsToPatch[0].database_id = databaseId
  return rawConfig
}

export function buildPreviewReviewerSeedSql(options) {
  const email = sqlString(options.email)
  const passwordHash = sqlString(options.passwordHash)
  const userId = sqlString(options.userId)
  const accountId = sqlString(options.accountId)
  const now = Number(options.now)

  return `
INSERT INTO user (id, name, email, email_verified, role, banned, ban_reason, ban_expires, created_at, updated_at)
VALUES (${userId}, 'Preview Reviewer', ${email}, 1, 'user', 0, NULL, NULL, ${now}, ${now})
ON CONFLICT(email) DO UPDATE SET
  name = excluded.name,
  email_verified = 1,
  role = 'user',
  banned = 0,
  ban_reason = NULL,
  ban_expires = NULL,
  updated_at = excluded.updated_at;

UPDATE account
SET password = ${passwordHash},
    updated_at = ${now}
WHERE provider_id = 'credential'
  AND user_id IN (SELECT id FROM user WHERE email = ${email});

INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
SELECT ${accountId}, u.id, 'credential', u.id, ${passwordHash}, ${now}, ${now}
FROM user AS u
WHERE u.email = ${email}
  AND NOT EXISTS (
    SELECT 1
    FROM account AS a
    WHERE a.provider_id = 'credential'
      AND a.user_id = u.id
  );
`.trimStart()
}

export function buildWranglerVersionsUploadArgs(configPath, slug) {
  return ['exec', 'wrangler', 'versions', 'upload', '--config', configPath, '--preview-alias', slug]
}

export function buildWranglerMigrateArgs(configPath) {
  return ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--config', configPath, '--remote']
}

export function buildWranglerExecuteFileArgs(configPath, sqlFile) {
  return ['exec', 'wrangler', 'd1', 'execute', 'DB', '--config', configPath, '--remote', '--file', sqlFile]
}

async function deploy() {
  await prepare()
  upload()
}

function upload() {
  const context = resolvePreviewContext()
  const configPath = valueAfter('--config') ?? process.env.ZPAN_PREVIEW_WRANGLER_CONFIG ?? DEFAULT_CONFIG_PATH

  console.log(`Uploading Worker preview with alias: ${context.slug}`)
  run('pnpm', buildWranglerVersionsUploadArgs(configPath, context.slug))
}

async function prepare() {
  const context = resolvePreviewContext()
  const configPath = valueAfter('--config') ?? process.env.ZPAN_PREVIEW_WRANGLER_CONFIG ?? DEFAULT_CONFIG_PATH

  console.log(`Preparing isolated Cloudflare preview D1: ${context.databaseName}`)
  let created = false
  try {
    const databaseId = resetPreviewDatabase(context.databaseName)
    created = true
    patchGeneratedWranglerConfig(configPath, context.databaseName, databaseId)
    run('pnpm', buildWranglerMigrateArgs(configPath))
    await seedPreviewReviewer(configPath)
    return context
  } catch (error) {
    if (created) deletePreviewDatabase(context.databaseName)
    throw error
  }
}

async function build() {
  const branch = process.env.WORKERS_CI_BRANCH
  const isWorkersPreview = process.env.WORKERS_CI === '1' && branch && branch !== 'main'
  run('pnpm', ['exec', 'vite', 'build'], {
    env: isWorkersPreview ? { CLOUDFLARE_ENV: DEFAULT_ENV } : {},
  })
  if (isWorkersPreview) await prepare()
}

function cleanup() {
  const { databaseName } = resolvePreviewContext()
  console.log(`Cleaning Cloudflare preview D1: ${databaseName}`)
  deletePreviewDatabase(databaseName)
}

function resetPreviewDatabase(databaseName) {
  assertPreviewDatabaseName(databaseName)
  deletePreviewDatabase(databaseName)
  return createPreviewDatabase(databaseName)
}

function listD1Databases() {
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'list', '--json'], { encoding: 'utf8' })
  return JSON.parse(output)
}

function deletePreviewDatabase(databaseName) {
  assertPreviewDatabaseName(databaseName)
  const existing = listD1Databases().find((db) => db.name === databaseName)
  if (!existing) {
    console.log(`No existing preview D1 database named ${databaseName}`)
    return
  }
  run('pnpm', ['exec', 'wrangler', 'd1', 'delete', databaseName, '--skip-confirmation'])
  console.log(`Deleted preview D1 database: ${databaseName}`)
}

function createPreviewDatabase(databaseName) {
  run('pnpm', ['exec', 'wrangler', 'd1', 'create', databaseName])
  try {
    const database = listD1Databases().find((candidate) => candidate.name === databaseName)
    if (!database?.uuid) throw new Error(`Created D1 database ${databaseName} was not returned by wrangler d1 list`)
    console.log(`Created preview D1 database: ${databaseName} (${database.uuid})`)
    return database.uuid
  } catch (error) {
    try {
      run('pnpm', ['exec', 'wrangler', 'd1', 'delete', databaseName, '--skip-confirmation'])
      console.log(`Deleted unconfirmed preview D1 database: ${databaseName}`)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Failed to create or clean up preview D1 database: ${databaseName}`,
      )
    }
    throw error
  }
}

async function seedPreviewReviewer(configPath) {
  const { hashPassword } = await import('../server/lib/password.ts')
  const sql = buildPreviewReviewerSeedSql({
    email: PREVIEW_REVIEWER_EMAIL,
    passwordHash: hashPassword(PREVIEW_REVIEWER_PASSWORD),
    userId: 'preview-reviewer',
    accountId: 'preview-reviewer-account',
    now: Date.UTC(2026, 0, 1),
  })

  const dir = mkdtempSync(path.join(tmpdir(), 'zpan-preview-seed-'))
  const file = path.join(dir, 'seed.sql')
  writeFileSync(file, sql)
  try {
    run('pnpm', buildWranglerExecuteFileArgs(configPath, file))
    console.log(`Seeded preview reviewer account: ${PREVIEW_REVIEWER_EMAIL}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function patchGeneratedWranglerConfig(configPath, databaseName, databaseId) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const patched = patchD1BindingConfig(config, databaseName, databaseId)
  writeFileSync(configPath, `${JSON.stringify(patched, null, 2)}\n`)
  console.log(`Patched generated Wrangler config D1 binding: ${configPath}`)
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    env: { ...process.env, ...options.env },
    stdio: 'inherit',
  })
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

function currentGitBranch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function currentGitRepository() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

const entrypoint = path.resolve(process.argv[1] ?? '')
if (entrypoint === fileURLToPath(import.meta.url)) {
  const command = args[0]
  const commands = new Set(['build', 'prepare', 'upload', 'deploy', 'cleanup'])
  if (args.includes('--help') || args.includes('-h') || !command || !commands.has(command)) {
    console.log(`Usage: cloudflare-branch-preview.mjs <build|prepare|upload|deploy|cleanup>

Commands:
  build    Build normally; Workers branch builds also prepare an isolated D1 for the subsequent upload
  prepare  Reset, migrate, seed, and bind the generated preview config without uploading
  upload   Upload the generated preview config and branch alias without resetting D1
  deploy   Reset a branch-preview D1, apply migrations, seed reviewer data, patch generated Wrangler config, upload preview
  cleanup  Delete only the current branch-preview D1 database

Environment:
  WORKERS_CI_BRANCH, GITHUB_HEAD_REF, GITHUB_REF_NAME, BRANCH_NAME, or ZPAN_PREVIEW_NAME selects the preview.
  ZPAN_PREVIEW_D1_DATABASE may override the database name, but it must start with ${PREVIEW_DB_PREFIX}.`)
    process.exit(command ? 1 : 0)
  }
  if (command === 'build') await build()
  else if (command === 'prepare') await prepare()
  else if (command === 'upload') upload()
  else if (command === 'deploy') await deploy()
  else cleanup()
}
