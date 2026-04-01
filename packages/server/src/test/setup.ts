import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createApp } from '../app'
import { createAuth } from '../auth'
import * as authSchema from '../db/auth-schema'
import * as schema from '../db/schema'
import type { Platform } from '../platform/interface'

const AUTH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS session_userId_idx ON session(user_id);
  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE INDEX IF NOT EXISTS account_userId_idx ON account(user_id);
  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
`

const APP_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS matters (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    alias TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    dirtype INTEGER DEFAULT 0,
    parent TEXT NOT NULL DEFAULT '',
    object TEXT NOT NULL DEFAULT '',
    storage_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storages (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    bucket TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'auto',
    access_key TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    file_path TEXT NOT NULL DEFAULT '',
    custom_host TEXT DEFAULT '',
    status INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storage_quotas (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    storage_id TEXT NOT NULL,
    quota INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS system_options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    public INTEGER DEFAULT 0
  );
`

export function createTestApp() {
  const sqlite = new Database(':memory:')
  sqlite.exec(AUTH_SCHEMA_SQL)
  sqlite.exec(APP_SCHEMA_SQL)

  const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })
  const platform: Platform = {
    db,
    getEnv: () => undefined,
  }
  const auth = createAuth(db, 'test-secret', 'http://localhost:3000')
  const app = createApp(platform, auth)

  return { app, db, auth }
}

export async function authedHeaders(
  app: ReturnType<typeof createApp>,
  email = 'test@example.com',
  password = 'password123456',
) {
  const signUpRes = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password }),
  })
  const cookies = signUpRes.headers.getSetCookie()
  return { Cookie: cookies.join('; ') }
}
