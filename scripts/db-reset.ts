import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createApp } from '../server/app'
import { createAuth } from '../server/auth'
import * as authSchema from '../server/db/auth-schema'
import * as schema from '../server/db/schema'
import type { Platform } from '../server/platform/interface'

const isD1 = process.argv.includes('--d1')

const NODE_DB_PATH = process.env.DATABASE_URL || './zpan.db'
const D1_STATE_DIR = '.wrangler/state/v3/d1'
const D1_DB_NAME = 'zpan-db-local'

// ── required env vars ──
const email = 'admin@zpan.dev'
const password = requireEnv('DEV_ADMIN_PASSWORD')
const name = 'Admin'

const storageConfig = {
  title: process.env.DEV_STORAGE_TITLE || 'Dev Storage',
  mode: 'private' as const,
  bucket: requireEnv('DEV_STORAGE_BUCKET'),
  endpoint: requireEnv('DEV_STORAGE_ENDPOINT'),
  region: 'auto',
  accessKey: requireEnv('DEV_STORAGE_ACCESS_KEY'),
  secretKey: requireEnv('DEV_STORAGE_SECRET_KEY'),
  customHost: '',
}

// ── 1. reset database ──
const platform = isD1 ? resetD1() : resetNode()

// ── 2. seed ──
const secret = process.env.BETTER_AUTH_SECRET || 'dev-secret-for-seed'
const auth = createAuth(platform.db, secret, 'http://localhost:8222')
const app = createApp(platform, auth)

// register admin user
const signUpRes = await app.request('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, password }),
})
if (!signUpRes.ok) throw new Error(`sign-up failed: ${signUpRes.status} ${await signUpRes.text()}`)
const cookies = signUpRes.headers.getSetCookie().join('; ')
console.log(`registered admin: ${email}`)

// create storage
const storageRes = await app.request('/api/admin/storages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies },
  body: JSON.stringify(storageConfig),
})
if (!storageRes.ok) throw new Error(`create storage failed: ${storageRes.status} ${await storageRes.text()}`)
const storage = (await storageRes.json()) as { id: string; title: string }
console.log(`created storage: ${storage.title} (${storage.id})`)

console.log('\ndone!')

// ── helpers ──

function resetNode(): Platform {
  for (const p of [NODE_DB_PATH, `${NODE_DB_PATH}-wal`, `${NODE_DB_PATH}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  console.log(`deleted ${NODE_DB_PATH}`)

  const sqlite = new Database(NODE_DB_PATH)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })
  migrate(db, { migrationsFolder: './migrations' })
  console.log('database migrated')

  return { db, getEnv: (key) => process.env[key] }
}

function resetD1(): Platform {
  // wipe D1 local state
  if (fs.existsSync(D1_STATE_DIR)) {
    fs.rmSync(D1_STATE_DIR, { recursive: true })
    console.log(`deleted ${D1_STATE_DIR}`)
  }

  // re-run migrations via wrangler
  execSync(`wrangler d1 migrations apply ${D1_DB_NAME} --local`, { stdio: 'inherit' })
  console.log('D1 local database migrated')

  // find the SQLite file wrangler just created
  const dbFile = findD1SqliteFile()
  const sqlite = new Database(dbFile)
  const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })

  return { db, getEnv: (key) => process.env[key] }
}

function findD1SqliteFile(): string {
  const base = path.join(D1_STATE_DIR, 'miniflare-D1DatabaseObject')
  if (!fs.existsSync(base)) throw new Error(`D1 state dir not found: ${base}`)
  const files = fs.readdirSync(base).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  if (files.length === 0) throw new Error('No D1 SQLite database file found after migration')
  return path.join(base, files[0])
}

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    console.error(`missing required env var: ${key}`)
    process.exit(1)
  }
  return val
}
