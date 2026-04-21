import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as authSchema from '../db/auth-schema.js'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function signUpAndGetHeaders(
  app: TestApp,
  email: string,
): Promise<{ headers: { Cookie: string }; userId: string }> {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test User', email, password: 'password123456' }),
  })
  const cookies = res.headers.getSetCookie().join('; ')
  const body = (await res.json()) as { user?: { id: string } }
  return { headers: { Cookie: cookies }, userId: body.user?.id ?? '' }
}

async function insertOrg(db: TestDb): Promise<string> {
  const id = nanoid()
  await db.insert(authSchema.organization).values({
    id,
    name: 'Test Org',
    slug: nanoid(),
    createdAt: new Date(),
  })
  return id
}

async function insertMember(db: TestDb, organizationId: string, userId: string, role = 'owner'): Promise<void> {
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  })
}

async function setActiveOrg(app: TestApp, cookies: string, orgId: string): Promise<string> {
  const res = await app.request('/api/auth/organization/set-active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies },
    body: JSON.stringify({ organizationId: orgId }),
  })
  const setCookies = res.headers.getSetCookie()
  if (setCookies.length === 0) return cookies

  const updated = new Map<string, string>()
  for (const c of cookies.split('; ')) {
    const eqIdx = c.indexOf('=')
    if (eqIdx >= 0) updated.set(c.slice(0, eqIdx), c.slice(eqIdx + 1))
  }
  for (const c of setCookies) {
    const [pair] = c.split(';')
    const eqIdx = pair.indexOf('=')
    if (eqIdx >= 0) updated.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim())
  }
  return [...updated.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

async function seedConfig(
  db: TestDb,
  orgId: string,
  overrides: Partial<{
    customDomain: string | null
    cfHostnameId: string | null
    domainVerifiedAt: Date | null
    refererAllowlist: string | null
  }> = {},
) {
  const now = new Date()
  await db.insert(schema.imageHostingConfigs).values({
    orgId,
    customDomain: overrides.customDomain ?? null,
    cfHostnameId: overrides.cfHostnameId ?? null,
    domainVerifiedAt: overrides.domainVerifiedAt ?? null,
    refererAllowlist: overrides.refererAllowlist ?? null,
    createdAt: now,
    updatedAt: now,
  })
}

/** Returns true if a URL string's host matches api.cloudflare.com (safe host check, no substring). */
function isCfUrl(url: unknown): boolean {
  try {
    return new URL(String(url)).host === 'api.cloudflare.com'
  } catch {
    return false
  }
}

// ─── Unauthenticated access ────────────────────────────────────────────────────

describe('GET /api/ihost/config — unauth', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/config')
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/ihost/config — unauth', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/ihost/config — unauth', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/ihost/config', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

// ─── Role enforcement ──────────────────────────────────────────────────────────

describe('/api/ihost/config — role enforcement', () => {
  it('GET allows any org member', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `member-get-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })

  it('GET allows viewer role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `viewer-get-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
  })

  it('PUT returns 403 for member role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `member-put-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  it('PUT returns 403 for viewer role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `viewer-put-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'viewer')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  it('PUT returns 403 for editor role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `editor-put-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'editor')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(403)
  })

  it('DELETE returns 403 for member role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `member-del-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'member')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    expect(res.status).toBe(403)
  })

  it('DELETE returns 403 for editor role', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `editor-del-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'editor')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    expect(res.status).toBe(403)
  })
})

// ─── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/ihost/config', () => {
  it('returns { enabled: false } when no config row exists', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-no-config-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean }
    expect(body.enabled).toBe(false)
  })

  it('returns domainStatus=none and null dnsInstructions when no customDomain set', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-no-domain-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId)

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string; dnsInstructions: null }
    expect(body.domainStatus).toBe('none')
    expect(body.dnsInstructions).toBeNull()
  })

  it('returns domainStatus=verified when domainVerifiedAt is set', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-verified-status-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const verifiedAt = new Date(Date.now() - 5000)
    await seedConfig(db, orgId, {
      customDomain: 'img.verified.com',
      domainVerifiedAt: verifiedAt,
    })

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string; domainVerifiedAt: number }
    expect(body.domainStatus).toBe('verified')
    expect(body.domainVerifiedAt).toBeGreaterThan(0)
  })

  it('returns parsed refererAllowlist array', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-referer-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, {
      refererAllowlist: JSON.stringify(['https://blog.example.com', 'https://app.example.com']),
    })

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { refererAllowlist: string[] }
    expect(body.refererAllowlist).toEqual(['https://blog.example.com', 'https://app.example.com'])
  })

  it('does NOT call CF when domain already verified', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-no-cf-call-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, {
      customDomain: 'img.example.com',
      cfHostnameId: 'cf-id-verified',
      domainVerifiedAt: new Date(Date.now() - 1000),
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)

    const cfCalls = (fetchMock.mock.calls as unknown[][]).filter(([url]) => isCfUrl(url))
    expect(cfCalls).toHaveLength(0)

    vi.unstubAllGlobals()
  })

  it('lazily verifies domain when CF getStatus returns active', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `get-lazy-verify-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, {
      customDomain: 'img.newdomain.com',
      cfHostnameId: 'cf-pending-id',
      domainVerifiedAt: null,
    })

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ result: { status: 'active', ssl: { status: 'active' } } }), { status: 200 }),
        ),
    )

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string; domainVerifiedAt: number }
    expect(body.domainStatus).toBe('verified')
    expect(body.domainVerifiedAt).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('stays pending when CF getStatus returns non-active', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `get-stay-pending-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, {
      customDomain: 'img.newdomain.com',
      cfHostnameId: 'cf-pending-id',
      domainVerifiedAt: null,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: { status: 'pending', ssl: { status: 'initializing' } } }), {
          status: 200,
        }),
      ),
    )

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string; domainVerifiedAt: null }
    expect(body.domainStatus).toBe('pending')
    expect(body.domainVerifiedAt).toBeNull()

    vi.unstubAllGlobals()
  })

  it('returns dnsInstructions with recordType=CNAME when CF is configured', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `get-cname-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const verifiedAt = new Date(Date.now() - 1000)
    await seedConfig(db, orgId, {
      customDomain: 'img.example.com',
      domainVerifiedAt: verifiedAt,
    })

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dnsInstructions: { recordType: string; target: string } }
    expect(body.dnsInstructions?.recordType).toBe('CNAME')
    expect(body.dnsInstructions?.target).toBe('ssl.zpan.io')
  })

  it('returns dnsInstructions with recordType=manual when CF is not configured', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-manual-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'img.example.com' })

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dnsInstructions: { recordType: string } }
    expect(body.dnsInstructions?.recordType).toBe('manual')
  })

  it('returns domainStatus=pending for unverified domain when CF creds are absent', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `get-no-cf-verify-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'img.noenv.com', cfHostnameId: 'some-id' })

    const res = await app.request('/api/ihost/config', { headers: { Cookie: updatedCookies } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string }
    expect(body.domainStatus).toBe('pending')
  })
})

// ─── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/ihost/config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates config row when enabled=true with no domain', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-enabled-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean; customDomain: null }
    expect(body.enabled).toBe(true)
    expect(body.customDomain).toBeNull()

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows).toHaveLength(1)
  })

  it('creates config with customDomain (no CF configured → cfHostnameId=null, domainStatus=pending)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-domain-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'img.example.com' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { enabled: boolean; customDomain: string; domainStatus: string }
    expect(body.enabled).toBe(true)
    expect(body.customDomain).toBe('img.example.com')
    expect(body.domainStatus).toBe('pending')
  })

  it('calls CF register when CF is configured and stores cfHostnameId', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `put-cf-reg-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { id: 'cf-new-id-123' } }), { status: 200 })),
    )

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'img.cf-test.com' }),
    })
    expect(res.status).toBe(200)

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows[0].cfHostnameId).toBe('cf-new-id-123')
    expect(rows[0].domainVerifiedAt).toBeNull()
  })

  it('changing customDomain calls CF delete then register', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `put-change-domain-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'old.example.com', cfHostnameId: 'cf-old-id' })

    const fetchCalls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        fetchCalls.push(String(init?.method ?? 'GET'))
        return new Response(JSON.stringify({ result: { id: 'cf-new-id-456' } }), { status: 200 })
      }),
    )

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'new.example.com' }),
    })
    expect(res.status).toBe(200)

    // First call must be DELETE (old), second must be POST (new)
    expect(fetchCalls[0]).toBe('DELETE')
    expect(fetchCalls[1]).toBe('POST')

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows[0].cfHostnameId).toBe('cf-new-id-456')
    expect(rows[0].domainVerifiedAt).toBeNull()
    expect(rows[0].customDomain).toBe('new.example.com')
  })

  it('returns 409 when CF register returns 409 conflict', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `put-cf-409-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"errors":[{"code":1403}]}', { status: 409 })))

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'taken.example.com' }),
    })
    expect(res.status).toBe(409)
  })

  it('domainStatus stays pending when CF creds are absent (no crash, config row created)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-no-cf-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'img.noclue.com' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { domainStatus: string; enabled: boolean }
    expect(body.enabled).toBe(true)
    expect(body.domainStatus).toBe('pending')

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows).toHaveLength(1)
  })

  it('returns 400 when enabled=false (must use DELETE to disable)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-disabled-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 when customDomain matches APP_HOST', async () => {
    const { app, db } = await createTestApp({ APP_HOST: 'zpan.example.com' })
    const { headers, userId } = await signUpAndGetHeaders(app, `put-apphost-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'zpan.example.com' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for refererAllowlist entry with path component', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-bad-ref-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, refererAllowlist: ['https://foo.com/path'] }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts valid refererAllowlist entries including port', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-good-ref-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        refererAllowlist: ['https://example.com', 'http://localhost:3000'],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { refererAllowlist: string[] }
    expect(body.refererAllowlist).toEqual(['https://example.com', 'http://localhost:3000'])
  })

  it('clears refererAllowlist when set to null', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-clear-ref-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { refererAllowlist: JSON.stringify(['https://old.com']) })

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, refererAllowlist: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { refererAllowlist: null }
    expect(body.refererAllowlist).toBeNull()
  })

  it('updates existing config when called twice (second PUT overrides first)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-update-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })

    const res2 = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, refererAllowlist: ['https://updated.com'] }),
    })
    expect(res2.status).toBe(200)
    const body = (await res2.json()) as { refererAllowlist: string[] }
    expect(body.refererAllowlist).toEqual(['https://updated.com'])
  })

  it('clears customDomain when set to null — domainStatus becomes none', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `put-clear-domain-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'old.example.com' })

    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: updatedCookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: null }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { customDomain: null; domainStatus: string }
    expect(body.customDomain).toBeNull()
    expect(body.domainStatus).toBe('none')
  })

  it('two orgs cannot register the same customDomain → 409', async () => {
    const { app, db } = await createTestApp()

    const email1 = `put-dup1-${nanoid()}@example.com`
    const email2 = `put-dup2-${nanoid()}@example.com`
    const { headers: h1, userId: uid1 } = await signUpAndGetHeaders(app, email1)
    const { headers: h2, userId: uid2 } = await signUpAndGetHeaders(app, email2)

    const orgId1 = await insertOrg(db)
    const orgId2 = await insertOrg(db)
    await insertMember(db, orgId1, uid1, 'owner')
    await insertMember(db, orgId2, uid2, 'owner')

    await setActiveOrg(app, h1.Cookie, orgId1)
    const cookies2 = await setActiveOrg(app, h2.Cookie, orgId2)

    // First org registers the domain directly in DB
    await seedConfig(db, orgId1, { customDomain: 'shared.example.com' })

    // Second org tries to register the same domain via API
    const res = await app.request('/api/ihost/config', {
      method: 'PUT',
      headers: { Cookie: cookies2, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'shared.example.com' }),
    })
    expect(res.status).toBe(409)
  })
})

// ─── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/ihost/config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns 204 and removes config row', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `del-basic-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    expect(res.status).toBe(204)

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows).toHaveLength(0)
  })

  it('returns 204 when no config row exists (idempotent)', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `del-noop-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    expect(res.status).toBe(204)
  })

  it('calls CF delete (best-effort) when cfHostnameId is set', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `del-cf-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'img.todelete.com', cfHostnameId: 'cf-del-id' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    expect(res.status).toBe(204)

    const calls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls
    const cfCalls = (calls as unknown[][]).filter(([url]) => isCfUrl(url))
    expect(cfCalls).toHaveLength(1)
    const [, init] = cfCalls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows).toHaveLength(0)
  })

  it('still removes row even if CF delete fails (best-effort)', async () => {
    const { app, db } = await createTestApp({
      CF_API_TOKEN: 'tok',
      CF_ZONE_ID: 'zone',
      CF_CNAME_TARGET: 'ssl.zpan.io',
    })
    const { headers, userId } = await signUpAndGetHeaders(app, `del-cf-fail-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId, { customDomain: 'img.fail.com', cfHostnameId: 'cf-fail-id' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))

    const res = await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })
    // Should still return 204 even though CF call failed
    expect(res.status).toBe(204)

    const rows = await db.select().from(schema.imageHostingConfigs).where(eq(schema.imageHostingConfigs.orgId, orgId))
    expect(rows).toHaveLength(0)
  })

  it('preserves image_hostings rows after config deletion', async () => {
    const { app, db } = await createTestApp()
    const { headers, userId } = await signUpAndGetHeaders(app, `del-preserve-${nanoid()}@example.com`)
    const orgId = await insertOrg(db)
    await insertMember(db, orgId, userId, 'owner')
    const updatedCookies = await setActiveOrg(app, headers.Cookie, orgId)

    await seedConfig(db, orgId)

    const storageId = nanoid()
    await db.insert(schema.storages).values({
      id: storageId,
      title: 'Test Storage',
      mode: 's3',
      bucket: 'test',
      endpoint: 'https://s3.example.com',
      region: 'auto',
      accessKey: 'key',
      secretKey: 'secret',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const imageId = nanoid()
    await db.insert(schema.imageHostings).values({
      id: imageId,
      orgId,
      token: `ih_${nanoid(10)}`,
      path: 'test/image.png',
      storageId,
      storageKey: `ih/${orgId}/${imageId}.png`,
      size: 1024,
      mime: 'image/png',
      createdAt: new Date(),
    })

    await app.request('/api/ihost/config', {
      method: 'DELETE',
      headers: { Cookie: updatedCookies },
    })

    const imageRows = await db.select().from(schema.imageHostings).where(eq(schema.imageHostings.id, imageId))
    expect(imageRows).toHaveLength(1)
  })
})
