/**
 * Playwright setup project — runs once before all device projects.
 * The webServer is already running when this executes.
 * Ensures an admin user and a storage backend exist.
 */
import { request as playwrightRequest, test as setup } from '@playwright/test'
import Database from 'better-sqlite3'
import { hashPassword } from '../server/lib/password'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers'

const localBaseUrl = process.env.E2E_LOCAL_BASE_URL ?? 'http://localhost:5173'
const defaultOrgQuota = process.env.E2E_DEFAULT_ORG_QUOTA ?? String(1024 * 1024 * 1024)

const storageConfig = {
  title: 'E2E Storage',
  mode: 'private',
  bucket: process.env.E2E_STORAGE_BUCKET ?? 'e2e-test',
  endpoint: process.env.E2E_STORAGE_ENDPOINT ?? 'https://localhost:9000',
  region: process.env.E2E_STORAGE_REGION ?? 'auto',
  accessKey: process.env.E2E_STORAGE_ACCESS_KEY ?? 'e2e-access-key',
  secretKey: process.env.E2E_STORAGE_SECRET_KEY ?? 'e2e-secret-key',
  capacity: 0,
  status: 'active',
}

type StorageItem = {
  id: string
  mode: string
  capacity: number
  used: number
  status: string
}

function isAvailablePrivateStorage(storage: StorageItem) {
  return (
    storage.mode === 'private' &&
    storage.status === 'active' &&
    (storage.capacity === 0 || storage.used < storage.capacity)
  )
}

function prepareNodeDatabase() {
  if (process.env.E2E_RUNTIME === 'cf') return

  const dbPath = process.env.DATABASE_URL || './zpan.db'
  const sqlite = new Database(dbPath)
  const passwordHash = hashPassword(ADMIN_PASSWORD)

  sqlite
    .prepare(
      `
        INSERT INTO system_options (key, value, public)
        VALUES ('auth_signup_mode', '', 1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, public = excluded.public
      `,
    )
    .run()

  sqlite
    .prepare(
      `
        INSERT INTO system_options (key, value, public)
        VALUES ('cloud_store_enabled', 'true', 0)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, public = excluded.public
      `,
    )
    .run()

  sqlite
    .prepare(
      `
        INSERT INTO system_options (key, value, public)
        VALUES (?, ?, 0), (?, ?, 0), (?, ?, 0)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    )
    .run(
      'cloud_store_created_at',
      new Date().toISOString(),
      'cloud_store_updated_at',
      new Date().toISOString(),
      'default_org_quota',
      defaultOrgQuota,
    )

  sqlite
    .prepare(
      `
        UPDATE user
        SET role = 'admin', email_verified = 1, updated_at = CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        WHERE email = ?
      `,
    )
    .run(ADMIN_EMAIL)

  sqlite
    .prepare(
      `
        UPDATE account
        SET password = ?, updated_at = CAST(unixepoch('subsecond') * 1000 AS INTEGER)
        WHERE provider_id = 'credential'
          AND user_id IN (SELECT id FROM user WHERE email = ?)
      `,
    )
    .run(passwordHash, ADMIN_EMAIL)

  sqlite.close()
}

function ensureNodeStorage() {
  if (process.env.E2E_RUNTIME === 'cf') return false

  const dbPath = process.env.DATABASE_URL || './zpan.db'
  const sqlite = new Database(dbPath)
  const storage = sqlite
    .prepare(
      `
        SELECT id, mode, capacity, used, status
        FROM storages
        ORDER BY created_at ASC
        LIMIT 1
      `,
    )
    .get() as StorageItem | undefined

  if (storage) {
    sqlite
      .prepare(
        `
          UPDATE storages
          SET title = ?, mode = ?, bucket = ?, endpoint = ?, region = ?, access_key = ?, secret_key = ?,
              capacity = ?, status = ?, updated_at = CAST(unixepoch('subsecond') * 1000 AS INTEGER)
          WHERE id = ?
        `,
      )
      .run(
        storageConfig.title,
        storageConfig.mode,
        storageConfig.bucket,
        storageConfig.endpoint,
        storageConfig.region,
        storageConfig.accessKey,
        storageConfig.secretKey,
        storageConfig.capacity,
        storageConfig.status,
        storage.id,
      )
    sqlite.close()
    return true
  }

  sqlite
    .prepare(
      `
        INSERT INTO storages (
          id, title, mode, bucket, endpoint, region, access_key, secret_key,
          file_path, custom_host, capacity, used, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 0, ?, CAST(unixepoch('subsecond') * 1000 AS INTEGER), CAST(unixepoch('subsecond') * 1000 AS INTEGER))
      `,
    )
    .run(
      crypto.randomUUID(),
      storageConfig.title,
      storageConfig.mode,
      storageConfig.bucket,
      storageConfig.endpoint,
      storageConfig.region,
      storageConfig.accessKey,
      storageConfig.secretKey,
      storageConfig.capacity,
      storageConfig.status,
    )
  sqlite.close()
  return true
}

setup('seed admin and storage', async () => {
  const request = await playwrightRequest.newContext({ baseURL: localBaseUrl })
  const headers = { Origin: localBaseUrl }
  try {
    prepareNodeDatabase()

    let authResp = await request.post('/api/auth/sign-in/email', {
      headers,
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })

    if (!authResp.ok()) {
      await request.post('/api/auth/sign-up/email', {
        headers,
        data: { name: 'E2E Admin', email: ADMIN_EMAIL, username: 'e2eadmin', password: ADMIN_PASSWORD },
      })
      prepareNodeDatabase()
      authResp = await request.post('/api/auth/sign-in/email', {
        headers,
        data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      })
      if (!authResp.ok()) {
        console.warn('[setup] could not authenticate admin')
        return
      }
    }

    const quotaResp = await request.put('/api/system/options/default_org_quota', {
      headers,
      data: { value: defaultOrgQuota },
    })
    if (!quotaResp.ok()) throw new Error(`could not set E2E default quota: ${quotaResp.status()}`)

    if (ensureNodeStorage()) return

    // E2E specs rely on self-service sign-up to create isolated users. Force the
    // local test environment into OPEN mode so existing dev DB settings do not
    // make the suite depend on invite codes.
    // Check if storage already exists
    const list = await request.get('/api/admin/storages', { headers })
    if (list.ok()) {
      const data = (await list.json()) as { items?: StorageItem[] }
      const storages = data.items ?? []
      if (storages.some(isAvailablePrivateStorage)) return

      const existing = storages[0]
      if (existing) {
        const resp = await request.put(`/api/admin/storages/${existing.id}`, {
          headers,
          data: storageConfig,
        })
        if (!resp.ok()) throw new Error(`could not update E2E storage: ${resp.status()}`)
        return
      }
    }

    // Seed storage
    const storageResp = await request.post('/api/admin/storages', {
      headers,
      data: storageConfig,
    })
    if (!storageResp.ok()) throw new Error(`could not create E2E storage: ${storageResp.status()}`)
  } finally {
    await request.dispose()
  }
})
