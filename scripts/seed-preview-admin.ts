import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'

export const PREVIEW_ADMIN_EMAIL = 'admin@zpan.space'

const STAGING_D1_DB = 'zpan-db-staging'
const STAGING_ENV = 'staging'

interface SeedSqlOptions {
  email: string
  passwordHash: string
  userId: string
  accountId: string
  now: number
}

export function buildPreviewAdminSeedSql(options: SeedSqlOptions): string {
  const email = sqlString(options.email)
  const passwordHash = sqlString(options.passwordHash)
  const userId = sqlString(options.userId)
  const accountId = sqlString(options.accountId)

  return `
INSERT INTO user (id, name, email, email_verified, role, banned, ban_reason, ban_expires, created_at, updated_at)
VALUES (${userId}, 'Admin', ${email}, 1, 'admin', 0, NULL, NULL, ${options.now}, ${options.now})
ON CONFLICT(email) DO UPDATE SET
  email_verified = 1,
  role = 'admin',
  banned = 0,
  ban_reason = NULL,
  ban_expires = NULL,
  updated_at = excluded.updated_at;

UPDATE account
SET password = ${passwordHash},
    updated_at = ${options.now}
WHERE provider_id = 'credential'
  AND user_id IN (SELECT id FROM user WHERE email = ${email});

INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
SELECT ${accountId}, u.id, 'credential', u.id, ${passwordHash}, ${options.now}, ${options.now}
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

export function buildWranglerArgs(sqlFile: string): string[] {
  return [
    'exec',
    'wrangler',
    'd1',
    'execute',
    STAGING_D1_DB,
    '--remote',
    '--env',
    STAGING_ENV,
    '--file',
    sqlFile,
  ]
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/* v8 ignore start -- exercised by CLI smoke/live runs; unit tests cover pure builders. */
async function main() {
  const args = new Set(process.argv.slice(2))
  if (args.has('--help') || args.has('-h')) {
    console.log(`Usage: pnpm seed:preview-admin

Repairs the non-production admin preview account in ${STAGING_D1_DB}.

Defaults:
  email: ${PREVIEW_ADMIN_EMAIL}

DEV_ADMIN_PASSWORD is required and must come from a private maintainer
credential source. Do not commit or print it.`)
    return
  }

  const password = process.env.DEV_ADMIN_PASSWORD
  if (!password) {
    throw new Error('DEV_ADMIN_PASSWORD is required to seed the preview admin account.')
  }

  const { hashPassword } = await import('../server/lib/password')
  const sql = buildPreviewAdminSeedSql({
    email: PREVIEW_ADMIN_EMAIL,
    passwordHash: hashPassword(password),
    userId: `preview-admin-${nanoid(12)}`,
    accountId: `preview-admin-account-${nanoid(12)}`,
    now: Date.now(),
  })

  const dir = mkdtempSync(path.join(tmpdir(), 'zpan-preview-admin-'))
  const file = path.join(dir, 'seed.sql')
  writeFileSync(file, sql)

  try {
    execFileSync('pnpm', buildWranglerArgs(file), { stdio: 'inherit' })
    console.log(`preview admin repaired: ${PREVIEW_ADMIN_EMAIL}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const entrypoint = path.resolve(process.argv[1] ?? '')
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main()
}
/* v8 ignore stop */
