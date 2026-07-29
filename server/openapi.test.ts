import { AuthorizationScope } from '@shared/authorization'
import { describe, expect, it } from 'vitest'
import { authRoute, findOperationsMissingAuthContract } from './http/openapi'
import { createTestApp } from './test/setup'

describe('global OpenAPI document', () => {
  it('aggregates every OpenAPIHono route at /api/openapi.json', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')

    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      paths: Record<string, { get?: { tags?: string[] } }>
      tags?: { name: string }[]
    }
    expect(doc.openapi).toBe('3.1.0')
    // Operations are tagged so Scalar groups them (not all under "default").
    expect(doc.paths['/api/objects']?.get?.tags).toContain('Objects')
    expect(doc.paths['/api/events']?.get?.tags).toContain('Events')
    expect((doc.tags ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(['Objects', 'Events', 'Download Tasks', 'Downloaders']),
    )
    // Every resource already converted to `.openapi()` shows up automatically.
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/downloads/tasks',
        '/api/downloads/tasks/{id}',
        '/api/downloads/tasks/{id}/status',
        '/api/downloads/tasks/{id}/attempts',
        '/api/downloads/downloaders',
        '/api/downloads/downloaders/{id}',
        '/api/events',
        '/api/objects',
        '/api/objects/{id}',
        '/api/objects/{id}/uploads/{uploadSessionId}/parts',
        '/api/objects/{id}/uploads/{uploadSessionId}/completions',
        '/api/objects/{id}/uploads/{uploadSessionId}',
        '/api/trash/objects',
        '/api/trash/objects/{id}',
        '/api/trash/objects/{id}/restorations',
      ]),
    )
  })

  it('serves the Scalar reference UI at /api/docs pointing at the spec', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('/api/openapi.json')
  })

  it('publishes Agent OAuth security schemes and Restish profiles', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      components?: { securitySchemes?: Record<string, unknown> }
      'x-cli-config'?: { auth?: Record<string, { params?: { client_id?: string; redirect_path?: string } }> }
    }

    expect(doc.components?.securitySchemes?.agentOAuth2).toMatchObject({
      type: 'oauth2',
      flows: { authorizationCode: { authorizationUrl: '/api/auth/oauth2/authorize' } },
    })
    expect(doc.components?.securitySchemes?.agentApiKey).toMatchObject({ type: 'http', scheme: 'bearer' })
    expect(doc['x-cli-config']?.auth?.reader?.params).toMatchObject({
      client_id: 'zpan-agent',
      redirect_path: '/callback',
    })
  })

  it('publishes OAuth discovery and protected-resource metadata at root locations', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [authServer, protectedResource] = await Promise.all([
      app.request('/.well-known/oauth-authorization-server/api/auth'),
      app.request('/.well-known/oauth-protected-resource/api'),
    ])

    expect(authServer.status).toBe(200)
    expect(await authServer.json()).toMatchObject({
      issuer: 'http://localhost:3000/api/auth',
      authorization_endpoint: 'http://localhost:3000/api/auth/oauth2/authorize',
      token_endpoint: 'http://localhost:3000/api/auth/oauth2/token',
      code_challenge_methods_supported: ['S256'],
    })
    expect(protectedResource.status).toBe(200)
    expect(await protectedResource.json()).toMatchObject({
      resource: 'http://localhost/api',
      authorization_servers: ['http://localhost/api/auth'],
      scopes_supported: expect.arrayContaining([AuthorizationScope.OBJECTS_READ]),
    })
  })

  it('documents the workspace-scoped API-key event-stream authorization contract', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        {
          get?: {
            description?: string
            responses?: Record<string, { description?: string }>
            'x-zpan-auth'?: unknown
          }
        }
      >
    }
    const events = doc.paths['/api/events']?.get

    expect(events?.responses?.['403']?.description).toBe('Forbidden')
    expect(events?.description).toContain('Workspace-scoped API keys')
    expect(events?.description).toContain('download-tasks:read')
    expect(events?.description).toContain('resource-change')
    expect(events?.['x-zpan-auth']).toMatchObject({
      access: 'protected',
      scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ],
    })
  })

  it('emits explicit authorization metadata for routes migrated to authRoute', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> }
    const migratedPaths = {
      '/api/events': doc.paths['/api/events'],
      '/api/downloads/tasks': doc.paths['/api/downloads/tasks'],
      '/api/downloads/tasks/{id}': doc.paths['/api/downloads/tasks/{id}'],
      '/api/downloads/tasks/{id}/events': doc.paths['/api/downloads/tasks/{id}/events'],
      '/api/downloads/tasks/{id}/status': doc.paths['/api/downloads/tasks/{id}/status'],
      '/api/downloads/tasks/{id}/attempts': doc.paths['/api/downloads/tasks/{id}/attempts'],
      '/api/downloads/downloaders/me/tasks': doc.paths['/api/downloads/downloaders/me/tasks'],
    }

    expect(findOperationsMissingAuthContract(migratedPaths)).toEqual([])
  })

  it('emits OpenAPI authorization metadata from one route declaration helper', () => {
    const route = authRoute(
      {
        access: 'protected',
        scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ],
        minTeamRole: 'viewer',
      },
      {
        operationId: 'authzProbe',
        method: 'get',
        path: '/probe',
        responses: { 200: { description: 'OK' } },
      },
    ) as {
      security?: unknown
      'x-zpan-auth'?: unknown
      middleware?: unknown[]
    }

    expect(route.security).toEqual([{ bearerAuth: [AuthorizationScope.DOWNLOAD_TASKS_READ] }, { cookieAuth: [] }])
    expect(route['x-zpan-auth']).toEqual({
      access: 'protected',
      scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ],
      minTeamRole: 'viewer',
      allowDownloader: false,
      auditDenied: true,
    })
    expect(route.middleware).toHaveLength(1)
  })

  it('detects OpenAPI operations missing explicit authorization declarations without an allowlist', () => {
    expect(
      findOperationsMissingAuthContract({
        '/public': { get: { 'x-zpan-auth': { access: 'public' } } },
        '/protected': { post: { 'x-zpan-auth': { access: 'protected' } } },
        '/missing': { delete: { responses: { 204: { description: 'Deleted' } } } },
      }),
    ).toEqual(['DELETE /missing'])
  })

  it('emits explicit authorization metadata for every hand-written OpenAPI operation', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> }
    const handWrittenPaths = Object.fromEntries(
      Object.entries(doc.paths).filter(([path]) => !path.startsWith('/api/auth/')),
    )

    expect(findOperationsMissingAuthContract(handWrittenPaths)).toEqual([])
  })

  it('documents downloader registration as admin or one-purpose bootstrap bearer auth', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown; 'x-zpan-auth'?: unknown }>>
    }

    const operation = doc.paths['/api/downloads/downloaders']?.post
    expect(operation?.security).toEqual([{ cookieAuth: [] }, { bearerAuth: [] }])
    expect(operation?.['x-zpan-auth']).toEqual({
      access: 'anyOf',
      policies: [{ access: 'admin' }, { access: 'downloader-bootstrap' }],
    })
  })

  it('documents owner role requirements for store operations that enforce owner team role', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, Record<string, { 'x-zpan-auth'?: unknown }>> }

    const ownerOperations = [
      doc.paths['/api/store/credits']?.get,
      doc.paths['/api/store/credits/ledger-entries']?.get,
      doc.paths['/api/store/credits/redemptions']?.post,
      doc.paths['/api/store/checkouts']?.post,
      doc.paths['/api/store/billing-portal-sessions']?.post,
      doc.paths['/api/store/orders']?.get,
      doc.paths['/api/store/orders/{orderId}/payments']?.post,
      doc.paths['/api/store/orders/{orderId}/status']?.put,
    ]

    for (const operation of ownerOperations) {
      expect(operation?.['x-zpan-auth']).toMatchObject({
        access: 'session',
        minTeamRole: 'owner',
      })
    }
  })

  it('documents the concrete public profile contract without the removed objects placeholder', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        {
          get?: {
            responses?: Record<string, { content?: { 'application/json'?: { schema?: { $ref?: string } } } }>
          }
        }
      >
      components?: {
        schemas?: Record<
          string,
          {
            properties?: Record<
              string,
              {
                type?: string
                properties?: Record<string, { type?: string; nullable?: boolean }>
                items?: {
                  type?: string
                  properties?: Record<string, { type?: string; nullable?: boolean }>
                  required?: string[]
                }
              }
            >
            required?: string[]
          }
        >
      }
    }

    expect(doc.paths['/api/users/{username}']?.get?.responses?.['200']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/PublicProfile',
    })
    expect(doc.paths['/api/users/{username}/objects']).toBeUndefined()

    const profile = doc.components?.schemas?.PublicProfile
    expect(profile?.required).toEqual(['user', 'shares'])
    expect(profile?.properties?.user).toMatchObject({
      type: 'object',
      properties: {
        username: { type: 'string' },
        name: { type: 'string' },
        image: { type: 'string', nullable: true },
      },
    })
    expect(profile?.properties?.shares).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string' },
          size: { type: 'integer', nullable: true },
          isFolder: { type: 'boolean' },
        },
        required: ['token', 'name', 'type', 'size', 'isFolder'],
      },
    })
  })

  it("merges better-auth's auto-generated schema (incl. the device flow) into the same doc", async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, unknown> }
    // better-auth's device-authorization endpoints come from its openAPI plugin,
    // not hand-written stubs — prefixed under /api/auth.
    const authPaths = Object.keys(doc.paths).filter((p) => p.startsWith('/api/auth/'))
    expect(authPaths.length).toBeGreaterThan(0)
    expect(authPaths.some((p) => p.includes('/device/'))).toBe(true)
  })
})
