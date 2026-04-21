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
    role TEXT,
    banned INTEGER DEFAULT 0,
    ban_reason TEXT,
    ban_expires INTEGER,
    username TEXT UNIQUE,
    display_username TEXT,
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
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    impersonated_by TEXT,
    active_organization_id TEXT
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
  CREATE TABLE IF NOT EXISTS organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE TABLE IF NOT EXISTS member (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE INDEX IF NOT EXISTS member_organizationId_idx ON member(organization_id);
  CREATE INDEX IF NOT EXISTS member_userId_idx ON member(user_id);
  CREATE TABLE IF NOT EXISTS invitation (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    inviter_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS invitation_organizationId_idx ON invitation(organization_id);
  CREATE INDEX IF NOT EXISTS invitation_email_idx ON invitation(email);
`

const APP_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS matters (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    alias TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    dirtype INTEGER DEFAULT 0,
    parent TEXT NOT NULL DEFAULT '',
    object TEXT NOT NULL DEFAULT '',
    storage_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    trashed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    bucket TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'auto',
    access_key TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    file_path TEXT NOT NULL DEFAULT '$UID/$RAW_NAME',
    custom_host TEXT DEFAULT '',
    capacity INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS org_quotas (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    quota INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS system_options (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    public INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    used_by TEXT,
    used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_invite_links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    inviter_id TEXT NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS team_invite_links_token_unique ON team_invite_links(token);
  CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    target_name TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_events_org_id_idx ON activity_events(org_id);
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    matter_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    password_hash TEXT,
    expires_at INTEGER,
    download_limit INTEGER,
    views INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shares_creator_status_created_idx ON shares(creator_id, status, created_at);
  CREATE TABLE IF NOT EXISTS share_recipients (
    id TEXT PRIMARY KEY,
    share_id TEXT NOT NULL,
    recipient_user_id TEXT,
    recipient_email TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS share_recipients_share_id_idx ON share_recipients(share_id);
  CREATE INDEX IF NOT EXISTS share_recipients_user_id_idx ON share_recipients(recipient_user_id);
  CREATE TABLE IF NOT EXISTS image_hosting_configs (
    org_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
    custom_domain TEXT UNIQUE,
    cf_hostname_id TEXT,
    domain_verified_at INTEGER,
    referer_allowlist TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS image_hostings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL,
    storage_id TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    status TEXT NOT NULL DEFAULT 'draft',
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS image_hostings_org_path_uniq ON image_hostings(org_id, path);
  CREATE INDEX IF NOT EXISTS image_hostings_org_created_idx ON image_hostings(org_id, created_at);
  CREATE INDEX IF NOT EXISTS image_hostings_token_idx ON image_hostings(token);
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    ref_type TEXT,
    ref_id TEXT,
    metadata TEXT,
    read_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications(user_id, read_at);
`

export async function createTestApp(envOverrides: Record<string, string> = {}) {
  const sqlite = new Database(':memory:')
  sqlite.exec(AUTH_SCHEMA_SQL)
  sqlite.exec(APP_SCHEMA_SQL)

  const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } })
  const platform: Platform = {
    db,
    getEnv: (key: string) => envOverrides[key],
  }
  const auth = await createAuth(db, 'test-secret', 'http://localhost:3000')
  const app = createApp(platform, auth)

  return { app, db, auth }
}

export async function adminHeaders(app: ReturnType<typeof createApp>) {
  // Sign up first user (gets promoted to admin via hook)
  await authedHeaders(app, 'admin@example.com', 'password123456')
  // Sign in again to get a session that reflects the admin role
  const signInRes = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123456' }),
  })
  return { Cookie: signInRes.headers.getSetCookie().join('; ') }
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
