import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'
import { S3Service } from '../services/s3'
import { createShare } from '../services/share'

const STORAGE_ID = 'st-cf-redirect'
const MOCK_PRESIGN_URL = 'https://presigned-cf.example.com/file'
const MOCK_INLINE_URL = 'https://presigned-inline-cf.example.com/image.png'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return { app: createApp(platform, auth), db: platform.db }
}

async function signUpAndGetIds(app: ReturnType<typeof createApp>, db: Awaited<ReturnType<typeof buildApp>>['db']) {
  const email = `cf-redirect-${Date.now()}@example.com`
  const signUpRes = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CF Redirect Test', email, password: 'password123456' }),
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
  opts: { id: string; name: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-cf-alias`}, ${opts.name}, 'image/png', 512, 0, '', 'keys/file.png', ${STORAGE_ID}, 'active', ${now}, ${now})
  `)
}

async function insertImageHosting(
  db: Awaited<ReturnType<typeof buildApp>>['db'],
  orgId: string,
  opts: { id: string; token: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${opts.id}, ${orgId}, ${opts.token}, ${'blog/' + opts.id + '.png'}, ${STORAGE_ID}, ${'ih/' + orgId + '/' + opts.id + '.png'}, 512, 'image/png', 'active', 0, ${now})
  `)
}

// ─── CF routing guard ─────────────────────────────────────────────────────────

describe('[CF] /r/* routing — Worker handles these paths', () => {
  it('/r/:token with unknown prefix returns 404 (Worker-handled, not CF Assets)', async () => {
    const { app } = await buildApp()
    const res = await app.request('/r/unknownprefix_token')
    expect(res.status).toBe(404)
    // Should be JSON (Worker response), not HTML (CF Assets SPA)
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })

  it('/dl/* is NOT routed (returns 404 — old path removed)', async () => {
    const { app } = await buildApp()
    const res = await app.request('/dl/any-token')
    expect(res.status).toBe(404)
  })
})

// ─── CF ds_ direct share tests ────────────────────────────────────────────────

describe('[CF] /r/:token ds_ direct shares', () => {
  it('returns 302 for valid direct share', async () => {
    vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue(MOCK_PRESIGN_URL)
    const { app, db } = await buildApp()
    const { orgId, userId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    await insertFile(db, orgId, { id: `cf-ds-${Date.now()}`, name: 'cf-direct.bin' })

    const rows = await db.all<{ id: string }>(sql`SELECT id FROM matters WHERE name = 'cf-direct.bin' LIMIT 1`)
    const matterId = rows[0].id
    const share = await createShare(db, { matterId, orgId, creatorId: userId, kind: 'direct' })

    const res = await app.request(`/r/${share.token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('cache-control')).toContain('no-store')
    vi.restoreAllMocks()
  })
})

// ─── CF ih_ image hosting tests ───────────────────────────────────────────────

describe('[CF] /r/:token ih_ image hosting', () => {
  it('returns 302 for active image hosting token', async () => {
    vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue(MOCK_INLINE_URL)
    const { app, db } = await buildApp()
    const { orgId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    const token = `ih_cf${Date.now()}`
    await insertImageHosting(db, orgId, { id: `cf-ih-${Date.now()}`, token })

    const res = await app.request(`/r/${token}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('public')
    vi.restoreAllMocks()
  })

  it('strips extension from ih_ token and resolves correctly', async () => {
    vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue(MOCK_INLINE_URL)
    const { app, db } = await buildApp()
    const { orgId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    const token = `ih_cfext${Date.now()}`
    await insertImageHosting(db, orgId, { id: `cf-ihext-${Date.now()}`, token })

    const res = await app.request(`/r/${token}.jpg`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    vi.restoreAllMocks()
  })
})

// ─── CF concurrent downloads — atomic limit enforcement ───────────────────────

describe('[CF] Concurrent downloads — atomic limit enforcement via /r/', () => {
  it('with limit=5 and 20 concurrent requests, exactly 5 succeed', async () => {
    const { app, db } = await buildApp()
    const { orgId, userId } = await signUpAndGetIds(app, db)
    await insertStorage(db)
    const fileId = `cf-dlc-r-${Date.now()}`
    await insertFile(db, orgId, { id: fileId, name: 'concurrent-r.bin' })

    const share = await createShare(db, {
      matterId: fileId,
      orgId,
      creatorId: userId,
      kind: 'direct',
      downloadLimit: 5,
    })

    // Fire 20 concurrent requests
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.request(`/r/${share.token}`, { redirect: 'manual' }).then((r) => r.status)),
    )

    // presignDownload will throw in CF test env (no real S3), so successful requests
    // (that passed the limit gate) may get 500. Count 302+500 as "passed the gate".
    const passed = results.filter((s) => s !== 410).length
    const rejected = results.filter((s) => s === 410).length

    expect(passed).toBe(5)
    expect(rejected).toBe(15)
  })
})
