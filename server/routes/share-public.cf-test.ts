import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'
import { createShare } from '../services/share'

// ─── CF routing regression guard ─────────────────────────────────────────────
// Verifies that public share JSON endpoints live under /api/* (Worker-handled)
// and NOT under /s/* (CF Assets serves the SPA there). These assertions catch
// any accidental re-mount before the bug reaches a preview deployment.
describe('[CF] Routing regression — share routes must be under /api/* or /dl/*', () => {
  it('/s/:token returns 404 (not routed) — JSON share API is not mounted at /s', async () => {
    const platform = createCloudflarePlatform(env)
    const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
    const app = createApp(platform, auth)

    const res = await app.request('/s/any-token')
    // 404 means no Worker route handles /s/* — correct: CF Assets owns this path.
    // If this becomes 200 with JSON it means a /s/* route was accidentally added.
    expect(res.status).toBe(404)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).not.toContain('application/json')
  })

  it('/api/shares/:token returns JSON (not SPA) — correct path for share API', async () => {
    const platform = createCloudflarePlatform(env)
    const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
    const app = createApp(platform, auth)

    const res = await app.request('/api/shares/nonexistent')
    expect(res.status).toBe(404)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })
})

const STORAGE_ID = 'st-cf-share'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return { app: createApp(platform, auth), db: platform.db }
}

async function signUpAndGetIds(app: ReturnType<typeof createApp>, db: Awaited<ReturnType<typeof buildApp>>['db']) {
  const email = `cf-share-${Date.now()}@example.com`
  const signUpRes = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CF Test', email, password: 'password123456' }),
  })
  const cookies = signUpRes.headers.getSetCookie().join('; ')

  const orgRows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at DESC LIMIT 1`,
  )
  const userRows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email} LIMIT 1`)

  return { headers: { Cookie: cookies }, orgId: orgRows[0].id, userId: userRows[0].id }
}

async function insertStorage(db: Awaited<ReturnType<typeof buildApp>>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'CF S3', 'private', 'cf-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertFile(
  db: Awaited<ReturnType<typeof buildApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-cf-alias`}, ${opts.name}, 'text/plain', 512, 0, ${opts.parent ?? ''}, 'keys/file.txt', ${STORAGE_ID}, 'active', ${now}, ${now})
  `)
}

describe('[CF] Public share routes — no requireAuth', () => {
  it('GET /api/shares/:token returns share metadata without auth', async () => {
    const { app, db } = await buildApp()
    const { orgId, userId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    await insertFile(db, orgId, { id: `cf-f1-${Date.now()}`, name: 'cf-file.txt' })

    const rows = await db.all<{ id: string }>(sql`SELECT id FROM matters WHERE name = 'cf-file.txt' LIMIT 1`)
    const matterId = rows[0].id
    const share = await createShare(db, { matterId, orgId, creatorId: userId, kind: 'landing' })

    const res = await app.request(`/api/shares/${share.token}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.kind).toBe('landing')
    const matter = body.matter as Record<string, unknown>
    expect(matter.name).toBe('cf-file.txt')
  })

  it('GET /dl/:token returns 404 for unknown token without auth', async () => {
    const { app } = await buildApp()
    const res = await app.request('/dl/nonexistent-cf-token')
    expect(res.status).toBe(404)
  })
})

describe('[CF] Concurrent downloads — atomic limit enforcement', () => {
  it('with limit=5 and 20 concurrent requests, exactly 5 succeed', async () => {
    const { app, db } = await buildApp()
    const { orgId, userId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    const fileId = `cf-dlc-${Date.now()}`
    await insertFile(db, orgId, { id: fileId, name: 'concurrent.bin' })

    // Spy on presignDownload to return a fake URL without hitting real S3
    const share = await createShare(db, {
      matterId: fileId,
      orgId,
      creatorId: userId,
      kind: 'direct',
      downloadLimit: 5,
    })

    // Fire 20 concurrent requests
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.request(`/dl/${share.token}`, { redirect: 'manual' }).then((r) => r.status)),
    )

    // Note: presignDownload will throw in CF test env (no real S3),
    // so successful requests (that passed the limit gate) may get 500.
    // We count 302 + 500 as "passed the gate", and 410 as "rejected by limit".
    const passed = results.filter((s) => s !== 410).length
    const rejected = results.filter((s) => s === 410).length

    expect(passed).toBe(5)
    expect(rejected).toBe(15)
  })
})
