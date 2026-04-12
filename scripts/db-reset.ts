import fs from 'node:fs'
import { createApp } from '../server/app'
import { createAuth } from '../server/auth'
import { createNodePlatform } from '../server/platform/node'

const DB_PATH = process.env.DATABASE_URL || './zpan.db'

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
  filePath: '$UID/$RAW_NAME',
  customHost: '',
}

// ── 1. delete old db ──
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH)
  // WAL/SHM files
  for (const ext of ['-wal', '-shm']) {
    const p = DB_PATH + ext
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
  console.log(`deleted ${DB_PATH}`)
}

// ── 2. init platform (runs migrations) ──
const platform = createNodePlatform()
const secret = process.env.BETTER_AUTH_SECRET || 'dev-secret-for-seed'
const auth = createAuth(platform.db, secret, 'http://localhost:8222')
const app = createApp(platform, auth)
console.log('database migrated')

// ── 3. register admin user ──
const signUpRes = await app.request('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, email, password }),
})
if (!signUpRes.ok) throw new Error(`sign-up failed: ${signUpRes.status} ${await signUpRes.text()}`)
const cookies = signUpRes.headers.getSetCookie().join('; ')
console.log(`registered admin: ${email}`)

// ── 4. create storage ──
const storageRes = await app.request('/api/admin/storages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies },
  body: JSON.stringify(storageConfig),
})
if (!storageRes.ok) throw new Error(`create storage failed: ${storageRes.status} ${await storageRes.text()}`)
const storage = (await storageRes.json()) as { id: string; title: string }
console.log(`created storage: ${storage.title} (${storage.id})`)

console.log('\ndone! run `npm run dev` to start.')

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) {
    console.error(`missing required env var: ${key}`)
    process.exit(1)
  }
  return val
}
