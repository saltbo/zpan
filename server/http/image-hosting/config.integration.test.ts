import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import * as authSchema from '../../db/auth-schema'
import * as schema from '../../db/schema'
import { createTestApp, seedProLicense } from '../../test/setup'

type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']
type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

async function ownerSession(app: TestApp, db: TestDb, pro = true) {
  if (pro) await seedProLicense(db)
  const email = `owner-${nanoid()}@example.com`
  const signUp = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Owner', email, password: 'password123456' }),
  })
  const user = (await signUp.json()) as { user: { id: string } }
  let cookie = signUp.headers.getSetCookie().join('; ')
  const orgId = nanoid()
  await db.insert(authSchema.organization).values({
    id: orgId,
    name: 'Image Team',
    slug: nanoid(),
    createdAt: new Date(),
  })
  await db.insert(authSchema.member).values({
    id: nanoid(),
    organizationId: orgId,
    userId: user.user.id,
    role: 'owner',
    createdAt: new Date(),
  })
  const active = await app.request('/api/auth/organization/set-active', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationId: orgId }),
  })
  if (active.headers.getSetCookie().length) cookie = active.headers.getSetCookie().join('; ')
  return { orgId, headers: { Cookie: cookie, Origin: 'http://localhost:3000' } }
}

async function configureManualProvider(deps: Awaited<ReturnType<typeof createTestApp>>['deps']) {
  await deps.systemOptions.setMany([
    { key: 'image_domain_enabled', value: 'true' },
    { key: 'image_domain_provider', value: 'manual' },
    {
      key: 'image_domain_manual_records',
      value: JSON.stringify([
        { type: 'A', value: '192.0.2.10' },
        { type: 'AAAA', value: '2001:db8::10' },
      ]),
    },
    { key: 'image_domain_last_tested_at', value: '2026-07-27T12:00:00.000Z' },
    { key: 'image_domain_error', value: '' },
  ])
}

describe('/api/image-hosting/config provider-backed domains', () => {
  it('requires authentication', async () => {
    const { app } = await createTestApp()
    expect((await app.request('/api/image-hosting/config')).status).toBe(401)
  })

  it('returns the stable disabled response shape [spec: image-hosting-config/default-disabled]', async () => {
    const { app, db } = await createTestApp()
    const { headers } = await ownerSession(app, db)
    const response = await app.request('/api/image-hosting/config', { headers })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      enabled: false,
      customDomain: null,
      domainVerifiedAt: null,
      domainStatus: 'none',
      domainError: null,
      dnsInstructions: null,
      verificationPath: null,
      refererAllowlist: null,
      createdAt: null,
    })
  })

  it('creates a manual domain and returns every configured DNS record plus challenge path [spec: image-hosting-config/manual-binding]', async () => {
    const { app, db, deps } = await createTestApp()
    await configureManualProvider(deps)
    const { orgId, headers } = await ownerSession(app, db)
    const response = await app.request('/api/image-hosting/config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        customDomain: 'img.example.com',
        refererAllowlist: ['https://blog.example.com'],
      }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      customDomain: 'img.example.com',
      domainStatus: 'pending_dns',
      dnsInstructions: [
        { recordType: 'A', name: 'img.example.com', target: '192.0.2.10' },
        { recordType: 'AAAA', name: 'img.example.com', target: '2001:db8::10' },
      ],
      refererAllowlist: ['https://blog.example.com'],
    })
    expect(body.verificationPath).toMatch(/^\/\.well-known\/zpan-domain-verification\/.+/)
    const stored = await db.query.imageHostingConfigs.findFirst({
      where: (table, { eq }) => eq(table.orgId, orgId),
    })
    expect(stored?.verificationToken).toBeTruthy()
  })

  it('requires Pro before an owner can configure a custom domain', async () => {
    const { app, db, deps } = await createTestApp()
    await configureManualProvider(deps)
    const { headers } = await ownerSession(app, db, false)
    const response = await app.request('/api/image-hosting/config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, customDomain: 'img.example.com' }),
    })
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: [
          {
            reason: 'FEATURE_NOT_AVAILABLE',
            metadata: { feature: 'image_custom_domains' },
          },
        ],
      },
    })
  })

  it('deletes the workspace config through the owner endpoint', async () => {
    const { app, db, deps } = await createTestApp()
    await configureManualProvider(deps)
    const { orgId, headers } = await ownerSession(app, db)
    const timestamp = new Date()
    await db.insert(schema.imageHostingConfigs).values({
      orgId,
      customDomain: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const response = await app.request('/api/image-hosting/config', { method: 'DELETE', headers })

    expect(response.status).toBe(204)
    await expect(deps.imageHostingConfigs.getByOrg(orgId)).resolves.toBeNull()
  })

  it('verifies a manual domain through the inbound HTTP challenge [spec: image-hosting-config/manual-verification]', async () => {
    const { app, db, deps } = await createTestApp()
    await configureManualProvider(deps)
    const { orgId } = await ownerSession(app, db)
    const token = nanoid(32)
    const timestamp = new Date()
    await db.insert(schema.imageHostingConfigs).values({
      orgId,
      customDomain: 'xn--5nq.example.com',
      domainProvider: 'manual',
      providerHostnameId: null,
      domainStatus: 'pending_dns',
      domainError: null,
      verificationToken: token,
      domainLastCheckedAt: null,
      domainVerifiedAt: null,
      refererAllowlist: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const response = await app.request(`/.well-known/zpan-domain-verification/${token}`, {
      headers: { host: 'xn--5nq.example.com' },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(token)
    const stored = await deps.imageHostingConfigs.getByOrg(orgId)
    expect(stored?.domainStatus).toBe('verified')
    expect(stored?.domainVerifiedAt).toBeInstanceOf(Date)
  })

  it('does not reveal a challenge for the wrong token [spec: image-hosting-config/challenge-secret]', async () => {
    const { app, db, deps } = await createTestApp()
    await configureManualProvider(deps)
    const { orgId } = await ownerSession(app, db)
    const timestamp = new Date()
    await db.insert(schema.imageHostingConfigs).values({
      orgId,
      customDomain: 'img.example.com',
      domainProvider: 'manual',
      domainStatus: 'pending_dns',
      verificationToken: 'correct-token',
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const response = await app.request('/.well-known/zpan-domain-verification/wrong-token', {
      headers: { host: 'img.example.com' },
    })
    expect(response.status).toBe(404)
  })
})
