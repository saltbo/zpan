import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS,
  WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  WEBDAV_API_KEY_RATE_LIMIT_WINDOW_MS,
} from '../../../shared/api-key-templates.js'
import { authedHeaders, createTestApp } from '../../test/setup.js'
import { ApiKeyRateLimitError } from '../../usecases/ports'
import { deleteApiKeysScopedToOrganization } from './api-key-scopes'
import { createApiKeyGateway } from './api-keys'

const apiKeys = createApiKeyGateway()

type TestApp = Awaited<ReturnType<typeof createTestApp>>

async function getUserAndOrg(db: TestApp['db']) {
  const users = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  const orgs = await db.all<{ id: string }>(
    sql`SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  if (!users[0] || !orgs[0]) throw new Error('expected seeded user and personal org')
  return { userId: users[0].id, orgId: orgs[0].id }
}

async function createOrgApiKey(
  auth: TestApp['auth'],
  configId: string,
  orgId: string,
  userId: string,
  rateLimitMax?: number,
) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: {
      configId,
      organizationId: orgId,
      userId,
      ...(rateLimitMax === undefined ? {} : { rateLimitMax, rateLimitTimeWindow: 60_000, rateLimitEnabled: true }),
    },
  })) as { key: string; id: string }
  return result
}

async function getApiKeyRow(db: TestApp['db'], id: string) {
  const rows = await db.all<{
    config_id: string
    reference_id: string
    metadata: string | null
    enabled: number
    rate_limit_enabled: number
    rate_limit_time_window: number | null
    rate_limit_max: number | null
    request_count: number
  }>(sql`
    SELECT config_id, reference_id, metadata, enabled,
           rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count
    FROM apikey
    WHERE id = ${id}
  `)
  if (!rows[0]) throw new Error('expected api key row')
  return rows[0]
}

describe('API keys', () => {
  it('stores every template as a user-owned key with a server-defined scope', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)

    const ihostResponse = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configId: 'ihost',
        organizationId: orgId,
        metadata: { scope: { mode: 'workspace', orgId: 'forged-org' } },
      }),
    })
    const webdavResponse = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId: 'webdav', metadata: { scope: { mode: 'workspace', orgId } } }),
    })
    const remoteDownloadResponse = await app.request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ configId: 'remote-download', organizationId: orgId }),
    })

    expect(ihostResponse.status).toBe(200)
    expect(webdavResponse.status).toBe(200)
    expect(remoteDownloadResponse.status).toBe(200)
    const ihost = (await ihostResponse.json()) as { id: string }
    const webdav = (await webdavResponse.json()) as { id: string }
    expect(await getApiKeyRow(db, ihost.id)).toMatchObject({
      reference_id: userId,
      metadata: JSON.stringify({ scope: { mode: 'workspace', orgId } }),
    })
    expect(await getApiKeyRow(db, webdav.id)).toMatchObject({
      reference_id: userId,
      metadata: JSON.stringify({ scope: { mode: 'user-workspaces' } }),
    })

    const listResponse = await app.request('/api/auth/api-key/list', { headers })
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as { apiKeys: Array<{ configId: string; referenceId: string }> }
    expect(listed.apiKeys.map((key) => key.configId).sort()).toEqual(['ihost', 'remote-download', 'webdav'])
    expect(listed.apiKeys.every((key) => key.referenceId === userId)).toBe(true)
  })

  it('persists the configured defaults for each API key template', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)

    const ihost = await createOrgApiKey(auth, 'ihost', orgId, userId)
    const remoteDownload = await createOrgApiKey(auth, 'remote-download', orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const webdav = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId },
    })) as { key: string; id: string }

    expect(await getApiKeyRow(db, ihost.id)).toMatchObject({
      config_id: 'ihost',
      reference_id: userId,
      rate_limit_enabled: 1,
      rate_limit_time_window: 60_000,
      rate_limit_max: 60,
      request_count: 0,
    })
    expect(await getApiKeyRow(db, webdav.id)).toMatchObject({
      config_id: 'webdav',
      reference_id: userId,
      rate_limit_enabled: 1,
      rate_limit_time_window: WEBDAV_API_KEY_RATE_LIMIT_WINDOW_MS,
      rate_limit_max: WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS,
      request_count: 0,
    })
    expect(await getApiKeyRow(db, remoteDownload.id)).toMatchObject({
      config_id: 'remote-download',
      reference_id: userId,
      rate_limit_enabled: 1,
      rate_limit_time_window: 60_000,
      rate_limit_max: 120,
      request_count: 0,
    })
  })

  it('returns the user owner and workspace scope for a workspace API key', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const remoteDownload = await createOrgApiKey(auth, 'remote-download', orgId, userId)

    await expect(apiKeys.verifyApiKey(auth, db, remoteDownload.key, 'remote-download')).resolves.toMatchObject({
      id: remoteDownload.id,
      referenceId: userId,
      scope: { mode: 'workspace', orgId },
    })
  })

  it('normalizes a legacy organization-owned key to the current owner', async () => {
    const { app, db, auth } = await createTestApp()
    const headers = await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const remoteDownload = await createOrgApiKey(auth, 'remote-download', orgId, userId)
    const ihost = await createOrgApiKey(auth, 'ihost', orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const webdav = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId },
    })) as { id: string }
    await db.run(sql`
      UPDATE apikey
      SET reference_id = ${orgId}, metadata = '{}'
      WHERE id IN (${remoteDownload.id}, ${ihost.id})
    `)
    await db.run(sql`UPDATE apikey SET metadata = '{}' WHERE id = ${webdav.id}`)

    await expect(apiKeys.verifyApiKey(auth, db, remoteDownload.key, 'remote-download')).resolves.toMatchObject({
      referenceId: userId,
      scope: { mode: 'workspace', orgId },
    })
    const row = await getApiKeyRow(db, remoteDownload.id)
    expect(row.reference_id).toBe(userId)
    expect(JSON.parse(row.metadata as string)).toEqual({ scope: { mode: 'workspace', orgId } })

    const listResponse = await app.request('/api/auth/api-key/list', { headers })
    expect(listResponse.status).toBe(200)
    const listed = (await listResponse.json()) as {
      apiKeys: Array<{ id: string; metadata: { scope: { mode: string; orgId?: string } } }>
    }
    expect(listed.apiKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ihost.id,
          metadata: { scope: { mode: 'workspace', orgId } },
        }),
        expect.objectContaining({
          id: webdav.id,
          metadata: { scope: { mode: 'user-workspaces' } },
        }),
      ]),
    )
    expect(await getApiKeyRow(db, ihost.id)).toMatchObject({ reference_id: userId })
  })

  it('deletes workspace-scoped keys with their organization but preserves WebDAV keys', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const ihost = await createOrgApiKey(auth, 'ihost', orgId, userId)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const webdav = (await (auth.api as any).createApiKey({
      body: { configId: 'webdav', userId },
    })) as { id: string }

    await deleteApiKeysScopedToOrganization(db, orgId)

    const rows = await db.all<{ id: string }>(sql`SELECT id FROM apikey`)
    expect(rows.map((row) => row.id)).not.toContain(ihost.id)
    expect(rows.map((row) => row.id)).toContain(webdav.id)
  })

  it('allows exactly maxRequests verifications before rejecting the next one', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const apiKey = await createOrgApiKey(auth, 'remote-download', orgId, userId, 2)

    expect(await apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).toMatchObject({ id: apiKey.id })
    expect(await apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).toMatchObject({ id: apiKey.id })
    await expect(apiKeys.verifyApiKey(auth, db, apiKey.key, 'remote-download')).rejects.toThrow(ApiKeyRateLimitError)
    expect(await getApiKeyRow(db, apiKey.id)).toMatchObject({ request_count: 2 })
  })

  it('business routes surface a rate-limited API key as too many requests', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { orgId, userId } = await getUserAndOrg(db)
    const apiKey = await createOrgApiKey(auth, 'remote-download', orgId, userId, 1)
    const headers = { Authorization: `Bearer ${apiKey.key}` }

    const allowed = await app.request('/api/downloads/tasks', { headers })
    const limited = await app.request('/api/downloads/tasks', { headers })

    expect(allowed.status).toBe(200)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    const body = (await limited.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Rate limit exceeded.')
    expect(body.error.status).toBe('RESOURCE_EXHAUSTED')
  })

  it('upgrades legacy WebDAV default rate limits before verification', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { userId } = await getUserAndOrg(db)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const apiKey = (await (auth.api as any).createApiKey({
      body: {
        configId: 'webdav',
        userId,
        permissions: { webdav: ['read'] },
      },
    })) as { key: string; id: string }

    await db.run(sql`
      UPDATE apikey
      SET rate_limit_max = ${WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS},
          request_count = ${WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS},
          last_request = ${Date.now()}
      WHERE id = ${apiKey.id}
    `)

    await expect(
      apiKeys.verifyApiKeyForPermission(auth, db, apiKey.key, 'webdav', 'read', 'webdav'),
    ).resolves.toMatchObject({ id: apiKey.id })
    expect(await getApiKeyRow(db, apiKey.id)).toMatchObject({
      rate_limit_max: WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS,
      request_count: WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS + 1,
    })
  })

  it('WebDAV surfaces a custom rate-limited API key as too many requests', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const { userId } = await getUserAndOrg(db)
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    const apiKey = (await (auth.api as any).createApiKey({
      body: {
        configId: 'webdav',
        userId,
        permissions: { webdav: ['read'] },
        rateLimitMax: 1,
        rateLimitTimeWindow: 60_000,
        rateLimitEnabled: true,
      },
    })) as { key: string; id: string }
    const headers = { Authorization: `Basic ${btoa(`test:${apiKey.key}`)}` }

    const allowed = await app.request('/dav/', { method: 'PROPFIND', headers })
    const limited = await app.request('/dav/', { method: 'PROPFIND', headers })

    expect(allowed.status).not.toBe(429)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('60')
    expect(await limited.text()).toBe('Rate limit exceeded.')
  })
})
