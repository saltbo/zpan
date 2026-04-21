import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'
import { S3Service } from '../services/s3'

const STORAGE_ID = 'st-cf-domain-test'
const MOCK_INLINE_URL = 'https://presigned-inline-cf-domain.example.com/image.png'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return { app: createApp(platform, auth), db: platform.db }
}

type TestDb = Awaited<ReturnType<typeof buildApp>>['db']

async function signUpAndGetOrgId(app: ReturnType<typeof createApp>, db: TestDb) {
  const email = `cf-domain-${Date.now()}@example.com`
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CF Domain Test', email, password: 'password123456' }),
  })
  const rows = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' ORDER BY created_at DESC LIMIT 1`,
  )
  return rows[0].id
}

async function insertStorage(db: TestDb) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR IGNORE INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${STORAGE_ID}, 'CF Domain S3', 'private', 'cf-bucket', 'https://s3.amazonaws.com', 'us-east-1', 'AK', 'SK', '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertImageHosting(db: TestDb, orgId: string, opts: { id: string; path: string }) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO image_hostings (id, org_id, token, path, storage_id, storage_key, size, mime, status, access_count, created_at)
    VALUES (${opts.id}, ${orgId}, ${`ih_${opts.id}`}, ${opts.path}, ${STORAGE_ID}, ${`ih/${orgId}/${opts.id}.png`}, 512, 'image/png', 'active', 0, ${now})
  `)
}

async function insertImageHostingConfig(
  db: TestDb,
  orgId: string,
  opts: { customDomain: string; verifiedAt?: number },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT OR REPLACE INTO image_hosting_configs (org_id, custom_domain, domain_verified_at, created_at, updated_at)
    VALUES (${orgId}, ${opts.customDomain}, ${opts.verifiedAt ?? now}, ${now}, ${now})
  `)
}

// ─── CF custom domain tests ───────────────────────────────────────────────────

describe('[CF] imageHostingDomain — custom Host serves image redirect', () => {
  it('with a mocked custom Host, Worker serves the image redirect', async () => {
    vi.spyOn(S3Service.prototype, 'presignInline').mockResolvedValue(MOCK_INLINE_URL)
    const { app, db } = await buildApp()
    const orgId = await signUpAndGetOrgId(app, db)
    await insertStorage(db)
    await insertImageHosting(db, orgId, { id: `cf-dm-${Date.now()}`, path: 'blog/shot.png' })
    await insertImageHostingConfig(db, orgId, { customDomain: 'img.cftest.com' })

    const res = await app.request('/blog/shot.png', {
      headers: { host: 'img.cftest.com' },
      redirect: 'manual',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(MOCK_INLINE_URL)
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toContain('public')
    vi.restoreAllMocks()
  })
})

describe('[CF] imageHostingDomain — workers.dev preview host uses normal routing', () => {
  it('with workers.dev preview host, normal routing works', async () => {
    const { app } = await buildApp()
    // workers.dev host → middleware passes through to normal Hono routing
    const res = await app.request('/api/health', {
      headers: { host: 'myproject.workers.dev' },
    })
    expect(res.status).toBe(200)
  })
})
