import { AuthorizationScope } from '@shared/authorization'
import { COMPATIBLE_IMAGE_TOKEN_PATTERN, COMPATIBLE_SHARE_TOKEN_PATTERN, OPAQUE_ID_PATTERN } from '@shared/ids'
import { describe, expect, it } from 'vitest'
import { authRoute, findOperationsMissingAuthContract } from './http/openapi'
import { createTestApp } from './test/setup'

describe('global OpenAPI document', () => {
  it('publishes compatibility contracts for stored IDs while preserving token namespaces', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            parameters?: Array<{ name: string; schema?: { pattern?: string } }>
            requestBody?: {
              content?: {
                'application/json'?: {
                  schema?: {
                    properties?: Record<string, { pattern?: string; items?: { pattern?: string } }>
                  }
                }
              }
            }
          }
        >
      >
      components?: { schemas?: Record<string, { properties?: Record<string, { pattern?: string }> }> }
    }
    const patternFor = (path: string, method: string, name: string) =>
      doc.paths[path]?.[method]?.parameters?.find((parameter) => parameter.name === name)?.schema?.pattern
    const bodyPropertyFor = (path: string, method: string, name: string) =>
      doc.paths[path]?.[method]?.requestBody?.content?.['application/json']?.schema?.properties?.[name]

    for (const path of [
      '/api/objects',
      '/api/shares',
      '/api/downloads/tasks',
      '/api/downloads/downloaders',
      '/api/site/storages',
    ]) {
      expect(
        bodyPropertyFor(path, 'post', 'id'),
        `${path} must not accept a caller-selected primary ID`,
      ).toBeUndefined()
    }

    expect(patternFor('/api/objects/{id}', 'get', 'id')).toBe(OPAQUE_ID_PATTERN.source)
    expect(patternFor('/api/objects/{id}/uploads/{uploadSessionId}', 'delete', 'uploadSessionId')).toBe(
      OPAQUE_ID_PATTERN.source,
    )
    expect(patternFor('/api/trash/objects/{id}', 'delete', 'id')).toBe(OPAQUE_ID_PATTERN.source)
    expect(patternFor('/api/oauth-grants/{grantId}', 'delete', 'grantId')).toBe(OPAQUE_ID_PATTERN.source)
    expect(patternFor('/api/site/audit-events', 'get', 'orgId')).toBe(OPAQUE_ID_PATTERN.source)
    expect(bodyPropertyFor('/api/objects', 'post', 'storageId')?.pattern).toBe(OPAQUE_ID_PATTERN.source)
    expect(bodyPropertyFor('/api/objects/{id}/transfers', 'post', 'targetOrgId')?.pattern).toBe(
      OPAQUE_ID_PATTERN.source,
    )
    expect(bodyPropertyFor('/api/shares', 'post', 'matterId')?.pattern).toBe(OPAQUE_ID_PATTERN.source)
    expect(bodyPropertyFor('/api/oauth-consent', 'post', 'workspaceIds')?.items?.pattern).toBe(OPAQUE_ID_PATTERN.source)
    expect(patternFor('/api/shares/{token}', 'get', 'token')).toBe(COMPATIBLE_SHARE_TOKEN_PATTERN.source)
    expect(patternFor('/api/shares/{token}/objects', 'get', 'token')).toBe(COMPATIBLE_SHARE_TOKEN_PATTERN.source)
    expect(doc.components?.schemas?.ImageHosting?.properties?.token?.pattern).toBe(
      COMPATIBLE_IMAGE_TOKEN_PATTERN.source,
    )
    expect(doc.components?.schemas?.ImageHostingDraft?.properties?.token?.pattern).toBe(
      COMPATIBLE_IMAGE_TOKEN_PATTERN.source,
    )
  })

  it('aggregates every OpenAPIHono route at /api/openapi.json', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')

    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      paths: Record<string, { get?: { tags?: string[] }; post?: Record<string, unknown> }>
      tags?: { name: string }[]
    }
    expect(doc.openapi).toBe('3.1.0')
    // Operations are tagged so Scalar groups them (not all under "default").
    expect(doc.paths['/api/objects']?.get?.tags).toContain('Objects')
    expect(doc.paths['/api/events']?.get?.tags).toContain('Events')
    expect((doc.tags ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining(['Objects', 'Events', 'Download Tasks', 'Downloaders', 'Downloader Device Flow']),
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
        '/api/auth/oauth2/authorization-details/catalog',
        '/api/auth/oauth2/register/{clientId}',
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
    expect(doc.paths['/api/auth/oauth2/authorization-details/catalog']?.get).toMatchObject({
      operationId: 'listAuthorizationDetailsCatalog',
      security: [{ oauth2: [AuthorizationScope.WORKSPACES_DISCOVER] }],
    })
    expect(doc.paths['/api/auth/oauth2/register/{clientId}']).toMatchObject({
      get: { operationId: 'getDynamicOAuthClientRegistration', security: [{ bearerAuth: [] }] },
      put: { operationId: 'updateDynamicOAuthClientRegistration', security: [{ bearerAuth: [] }] },
      delete: { operationId: 'deleteDynamicOAuthClientRegistration', security: [{ bearerAuth: [] }] },
    })
    expect(doc.paths['/api/auth/oauth2/register']?.post).toMatchObject({
      responses: {
        '201': {
          content: {
            'application/json': {
              schema: {
                properties: {
                  registration_client_uri: { type: 'string', format: 'uri' },
                  registration_access_token: { type: 'string' },
                },
                required: expect.arrayContaining(['registration_client_uri', 'registration_access_token']),
              },
            },
          },
        },
      },
    })
  })

  it('serves the Scalar reference UI at /api/docs pointing at the spec', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/docs')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('/api/openapi.json')
  })

  it('documents and returns the request correlation header', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      components?: { headers?: Record<string, unknown> }
      paths?: Record<string, { get?: { responses?: Record<string, { headers?: Record<string, unknown> }> } }>
    }

    expect(res.headers.get('Request-Id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(doc.components?.headers?.RequestId).toMatchObject({ schema: { type: 'string', format: 'uuid' } })
    expect(doc.paths?.['/api/objects']?.get?.responses?.['200']?.headers?.['Request-Id']).toEqual({
      $ref: '#/components/headers/RequestId',
    })
  })

  it('advertises and serves the Arazzo workflow description', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [rootResponse, workflowResponse, documentResponse] = await Promise.all([
      app.request('https://zpan.example/api'),
      app.request('https://zpan.example/api/workflows.arazzo.json'),
      app.request('https://zpan.example/api/openapi.json'),
    ])
    const root = (await rootResponse.json()) as { workflows?: string }
    const workflows = (await workflowResponse.json()) as {
      arazzo?: string
      $self?: string
      sourceDescriptions?: { name?: string; url?: string; type?: string }[]
      workflows?: {
        workflowId?: string
        steps?: { operationId?: string }[]
        outputs?: Record<string, string>
      }[]
    }
    const document = (await documentResponse.json()) as {
      externalDocs?: { description?: string; url?: string }
      paths?: Record<string, Record<string, { operationId?: string }>>
    }

    expect(rootResponse.status).toBe(200)
    expect(rootResponse.headers.get('link')).toContain(
      '</api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
    )
    expect(rootResponse.headers.get('link')).toContain(
      '</api/workflows.arazzo.json>; rel="describedby"; type="application/vnd.oai.workflows+json"',
    )
    expect(root.workflows).toBe('/api/workflows.arazzo.json')

    expect(workflowResponse.status).toBe(200)
    expect(workflowResponse.headers.get('content-type')).toBe('application/vnd.oai.workflows+json; version=1.1.0')
    expect(workflows).toMatchObject({
      arazzo: '1.1.0',
      $self: 'https://zpan.example/api/workflows.arazzo.json',
      sourceDescriptions: [{ name: 'zpan', url: './openapi.json', type: 'openapi' }],
    })
    expect(workflows.workflows?.map((workflow) => workflow.workflowId)).toEqual([
      'prepareDirectFileUpload',
      'purchaseStorageCapacityWithX402',
      'refreshDirectFileUploadParts',
      'completeDirectFileUpload',
      'abortDirectFileUpload',
    ])
    const workflowOperationIds = workflows.workflows
      ?.flatMap((workflow) => workflow.steps ?? [])
      .map((step) => step.operationId)
    expect(workflowOperationIds).toEqual([
      'createObject',
      'purchaseStorageCapacity',
      'presignObjectUploadParts',
      'completeObjectUpload',
      'abortObjectUpload',
    ])
    const openApiOperationIds = new Set(
      Object.values(document.paths ?? {}).flatMap((path) =>
        Object.values(path).flatMap((operation) => operation.operationId ?? []),
      ),
    )
    expect(workflowOperationIds?.every((operationId) => operationId && openApiOperationIds.has(operationId))).toBe(true)
    expect(workflows.workflows?.[0]?.outputs).toMatchObject({
      objectId: '$steps.createUploadDraft.outputs.objectId',
      sessionId: '$steps.createUploadDraft.outputs.sessionId',
      upload: '$steps.createUploadDraft.outputs.upload',
    })
    expect(document.externalDocs).toEqual({
      description: 'Machine-readable API workflows (Arazzo 1.1)',
      url: '/api/workflows.arazzo.json',
    })

    const headResponse = await app.request('https://zpan.example/api/workflows.arazzo.json', { method: 'HEAD' })
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('content-type')).toBe('application/vnd.oai.workflows+json; version=1.1.0')
    expect(await headResponse.text()).toBe('')
  })

  it('publishes the external OAuth scope catalog without client-owned credential configuration', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      components?: {
        securitySchemes?: Record<
          string,
          { type?: string; scheme?: string; flows?: { authorizationCode?: { scopes?: Record<string, string> } } }
        >
      }
      'x-cli-config'?: unknown
    }

    expect(doc.components?.securitySchemes?.oauth2).toMatchObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: '/api/auth/oauth2/authorize',
          tokenUrl: '/api/auth/oauth2/token',
          refreshUrl: '/api/auth/oauth2/token',
          scopes: expect.objectContaining({
            [AuthorizationScope.WORKSPACES_DISCOVER]: 'Discover workspaces available to the connected account',
            [AuthorizationScope.OBJECTS_READ]: 'List, inspect, and download objects',
            [AuthorizationScope.OBJECTS_CREATE]: 'Create folders and upload objects',
            [AuthorizationScope.SHARES_CREATE]: 'Create public shares',
            [AuthorizationScope.QUOTA_PURCHASE]: 'Purchase workspace storage capacity',
          }),
        },
      },
    })
    expect(doc.components?.securitySchemes?.agentApiKey).toBeUndefined()
    expect(doc['x-cli-config']).toBeUndefined()
  })

  it('publishes scopes through authorization-server metadata without a duplicate catalog endpoint', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    expect((await app.request('/api/oauth-resource-scopes')).status).toBe(404)
    const response = await app.request('/.well-known/oauth-authorization-server/api/auth')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      scopes_supported: expect.arrayContaining([
        AuthorizationScope.OBJECTS_READ,
        AuthorizationScope.OBJECTS_CREATE,
        AuthorizationScope.OBJECTS_UPDATE,
      ]),
    })
  })

  it('publishes relative servers and discovery links for self-hosted origins', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      servers?: { url?: string }[]
      'x-zpan-discovery'?: Record<string, string>
    }

    expect(doc.servers).toEqual([{ url: '/', description: 'Current ZPan origin' }])
    expect(doc['x-zpan-discovery']).toEqual({
      oauthAuthorizationServer: '/.well-known/oauth-authorization-server/api/auth',
      oauthProtectedResource: '/.well-known/oauth-protected-resource/api',
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
      authorization_servers: ['http://localhost:3000/api/auth'],
      bearer_methods_supported: [],
      scopes_supported: expect.arrayContaining([AuthorizationScope.OBJECTS_READ]),
      dpop_bound_access_tokens_required: true,
    })

    const protectedHead = await app.request('/.well-known/oauth-protected-resource/api', { method: 'HEAD' })
    expect(protectedHead.status).toBe(200)
  })

  it('serves RFC discovery paths for OAuth and OpenID metadata', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [authServer, openidConfig, openidHead] = await Promise.all([
      app.request('/.well-known/oauth-authorization-server/api/auth', { method: 'HEAD' }),
      app.request('/.well-known/openid-configuration/api/auth'),
      app.request('/.well-known/openid-configuration/api/auth', { method: 'HEAD' }),
    ])

    expect(authServer.status).toBe(200)
    expect(openidConfig.status).toBe(200)
    expect(await openidConfig.json()).toMatchObject({
      issuer: 'http://localhost:3000/api/auth',
      authorization_endpoint: 'http://localhost:3000/api/auth/oauth2/authorize',
      token_endpoint: 'http://localhost:3000/api/auth/oauth2/token',
      authorization_details_catalog_endpoint: 'http://localhost:3000/api/auth/oauth2/authorization-details/catalog',
      authorization_details_catalog_scope: AuthorizationScope.WORKSPACES_DISCOVER,
      authorization_details_catalog_version: 1,
    })
    expect(openidHead.status).toBe(200)
    expect(await authServer.text()).toBe('')
    expect(await openidHead.text()).toBe('')
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
            security?: Record<string, string[]>[]
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
    expect(events?.security).toEqual([
      { oauth2: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
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

    expect(route.security).toEqual([
      { oauth2: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
    expect(route['x-zpan-auth']).toBeUndefined()
    expect(route.middleware).toHaveLength(1)
  })

  it('installs runtime authorization for public and scoped policies', () => {
    const declarations = [
      { public: true },
      { scopes: [AuthorizationScope.OBJECTS_READ] },
      {
        scopes: [AuthorizationScope.SITE_ANALYTICS_READ],
        siteRole: 'admin',
      },
      {
        scopes: [AuthorizationScope.TEAMS_READ],
        minTeamRole: 'viewer',
      },
      { scopes: [AuthorizationScope.DOWNLOADERS_UPDATE] },
      { scopes: [AuthorizationScope.DOWNLOADERS_CREATE], siteRole: 'admin' },
    ] as const

    for (const [index, declaration] of declarations.entries()) {
      const route = authRoute(declaration, {
        operationId: `runtimeAuthProbe${index}`,
        method: 'get',
        path: `/runtime-auth-probe-${index}`,
        responses: { 200: { description: 'OK' } },
      }) as { middleware?: unknown[] }

      expect(route.middleware).toHaveLength(1)
    }
  })

  it('declares standard OAuth, bearer, and cookie alternatives for protected operations', () => {
    const route = authRoute(
      {
        scopes: [AuthorizationScope.OBJECTS_CREATE],
        minTeamRole: 'editor',
      },
      {
        operationId: 'agentGrantableAuthzProbe',
        method: 'post',
        path: '/probe',
        responses: { 200: { description: 'OK' } },
      },
    ) as { security?: unknown }

    expect(route.security).toEqual([
      { oauth2: [AuthorizationScope.OBJECTS_CREATE] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
  })

  it('keeps role constraints separate from authentication and scopes', () => {
    const adminRoute = authRoute(
      {
        scopes: [AuthorizationScope.SITE_ANALYTICS_READ],
        siteRole: 'admin',
      },
      {
        operationId: 'sessionProbe',
        method: 'get',
        path: '/probe',
        responses: { 200: { description: 'OK' } },
      },
    ) as { security?: unknown; 'x-zpan-authorization-constraints'?: unknown }

    expect(adminRoute.security).toEqual([
      { oauth2: [AuthorizationScope.SITE_ANALYTICS_READ] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
    expect(adminRoute['x-zpan-authorization-constraints']).toEqual({
      requiredScopes: [AuthorizationScope.SITE_ANALYTICS_READ],
      siteRole: 'admin',
    })
  })

  it('detects OpenAPI operations missing explicit authorization declarations without an allowlist', () => {
    expect(
      findOperationsMissingAuthContract({
        '/public': { get: { security: [] } },
        '/protected': {
          post: {
            security: [{ oauth2: ['objects:read'] }],
            'x-zpan-authorization-constraints': { requiredScopes: ['objects:read'] },
          },
        },
        '/missing': { delete: { responses: { 204: { description: 'Deleted' } } } },
      }),
    ).toEqual(['DELETE /missing'])
  })

  it('requires every non-public OpenAPI operation to declare at least one scope', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as { paths: Record<string, Record<string, unknown>> }

    expect(findOperationsMissingAuthContract(doc.paths)).toEqual([])
  })

  it('documents downloader registration with its scope and session admin constraint', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown; 'x-zpan-authorization-constraints'?: unknown }>>
    }

    const operation = doc.paths['/api/downloads/downloaders']?.post
    expect(operation?.security).toEqual([
      { oauth2: [AuthorizationScope.DOWNLOADERS_CREATE] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
    expect(operation?.['x-zpan-authorization-constraints']).toEqual({
      requiredScopes: [AuthorizationScope.DOWNLOADERS_CREATE],
      siteRole: 'admin',
    })
  })

  it('authorizes permanent purge with its OAuth scope independently from the credential type', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { security?: unknown; 'x-zpan-authorization-constraints'?: unknown }>>
    }

    const operation = doc.paths['/api/trash/objects/{id}']?.delete
    expect(operation?.security).toEqual([
      { oauth2: [AuthorizationScope.OBJECTS_PURGE] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
    expect(operation?.['x-zpan-authorization-constraints']).toEqual({
      requiredScopes: [AuthorizationScope.OBJECTS_PURGE],
      minTeamRole: 'editor',
    })
  })

  it('publishes stable upload operations for Restish plugin discovery', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        Record<
          string,
          {
            operationId?: string
            security?: Record<string, string[]>[]
            parameters?: { name?: string; in?: string; required?: boolean; schema?: unknown }[]
            requestBody?: {
              content?: {
                'application/json'?: { schema?: { properties?: Record<string, unknown>; required?: string[] } }
              }
            }
            responses?: Record<
              string,
              {
                content?: {
                  'application/json'?: { schema?: { $ref?: string; allOf?: unknown[]; properties?: unknown } }
                }
              }
            >
          }
        >
      >
    }

    expect(doc.paths['/api/objects']?.post).toMatchObject({
      operationId: 'createObject',
    })
    expect(doc.paths['/api/store/capacity-purchases/{resourceId}']?.post).toMatchObject({
      operationId: 'purchaseStorageCapacity',
      description: expect.stringContaining('same requestHash with a fresh idempotencyKey'),
      responses: { 429: expect.any(Object) },
    })
    for (const [status, resultStatus] of [
      ['200', 'delivered'],
      ['202', 'pending'],
    ]) {
      expect(
        doc.paths['/api/store/capacity-purchases/{resourceId}']?.post?.responses?.[status]?.content?.[
          'application/json'
        ]?.schema,
      ).toMatchObject({
        type: 'object',
        required: ['attemptId', 'orderId', 'resourceId', 'requestHash', 'status'],
        properties: { status: { type: 'string', enum: [resultStatus] } },
      })
    }
    expect(
      doc.paths['/api/store/capacity-purchases/{resourceId}']?.post?.responses?.['402']?.content?.['application/json']
        ?.schema,
    ).toMatchObject({
      type: 'object',
      required: ['x402Version', 'resource', 'accepts'],
    })
    expect(doc.paths['/api/objects']?.post?.security).toEqual([
      { oauth2: [AuthorizationScope.OBJECTS_CREATE] },
      { bearerAuth: [] },
      { cookieAuth: [] },
    ])
    expect(doc.paths['/api/objects']?.post?.responses?.['201']).toBeDefined()
    expect(doc.paths['/api/objects']?.post?.responses?.['402']?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/CapacityRequired',
    })
    expect(doc.paths['/api/objects']?.post?.responses?.['422']).toBeDefined()
    expect(doc.paths['/api/objects']?.post?.requestBody).toBeDefined()
    expect(doc.paths['/api/objects']?.post?.requestBody?.content?.['application/json']?.schema).toMatchObject({
      required: ['name'],
      properties: {
        name: expect.any(Object),
        type: expect.any(Object),
        size: expect.any(Object),
        parent: {
          description:
            'Slash-delimited parent folder path relative to the workspace root; use an empty string for the root.',
          default: '',
          type: 'string',
        },
        onConflict: expect.any(Object),
        storageId: {
          description:
            'Only site administrators may set this field; omit it to let ZPan automatically select an available storage.',
        },
      },
    })
    expect(doc.paths['/api/objects']?.post?.responses?.['201']?.content?.['application/json']?.schema).toMatchObject({
      allOf: [
        { $ref: '#/components/schemas/Matter' },
        {
          type: 'object',
          properties: {
            upload: {
              type: 'object',
              required: [
                'sessionId',
                'uploadId',
                'mode',
                'partSize',
                'partCount',
                'expiresAt',
                'presignedExpiresAt',
                'requiredHeaders',
                'urls',
                'parts',
                'workflow',
              ],
            },
          },
        },
      ],
    })
    expect(doc.paths['/api/objects/{id}/uploads/{uploadSessionId}/parts']?.post).toMatchObject({
      operationId: 'presignObjectUploadParts',
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({ name: 'uploadSessionId', in: 'path', required: true }),
      ]),
      requestBody: {
        content: {
          'application/json': {
            schema: { required: ['partNumbers'], properties: { partNumbers: expect.any(Object) } },
          },
        },
      },
      responses: {
        200: {
          content: {
            'application/json': {
              schema: {
                required: [
                  'uploadId',
                  'mode',
                  'partSize',
                  'partCount',
                  'presignedExpiresAt',
                  'requiredHeaders',
                  'parts',
                ],
                properties: {
                  mode: { type: 'string', enum: ['single', 'multipart'] },
                  parts: expect.any(Object),
                },
              },
            },
          },
        },
      },
    })
    expect(doc.paths['/api/objects/{id}/uploads/{uploadSessionId}/completions']?.post).toMatchObject({
      operationId: 'completeObjectUpload',
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({ name: 'uploadSessionId', in: 'path', required: true }),
      ]),
      requestBody: {
        content: {
          'application/json': {
            schema: { required: ['parts'], properties: { parts: expect.any(Object) } },
          },
        },
      },
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Matter' } } } } },
    })
    expect(doc.paths['/api/objects/{id}/uploads/{uploadSessionId}']?.delete).toMatchObject({
      operationId: 'abortObjectUpload',
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({ name: 'uploadSessionId', in: 'path', required: true }),
        expect.objectContaining({ name: 'strictStorageCleanup', in: 'query', required: false }),
      ]),
      responses: { 204: { description: 'Aborted upload and discarded the draft' } },
    })
    expect(
      doc.paths['/api/objects/{id}/uploads/{uploadSessionId}']?.delete?.responses?.['204']?.content,
    ).toBeUndefined()
  })

  it('documents owner role requirements for store operations that enforce owner team role', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { 'x-zpan-authorization-constraints'?: unknown }>>
    }

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
      expect(operation?.['x-zpan-authorization-constraints']).toMatchObject({
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

  it('publishes only the registered Better Auth Downloader Device Flow operations', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<
        string,
        {
          get?: Record<string, unknown>
          post?: {
            operationId?: string
            tags?: string[]
            security?: Record<string, string[]>[]
            responses?: Record<
              string,
              {
                content?: {
                  'application/json'?: {
                    schema?: { properties?: Record<string, unknown>; required?: string[] }
                  }
                }
              }
            >
          }
        }
      >
      components?: {
        headers?: Record<string, unknown>
        schemas?: Record<string, unknown>
      }
    }

    expect(Object.keys(doc.paths).filter((path) => path.startsWith('/api/auth/device/'))).toEqual([
      '/api/auth/device/code',
      '/api/auth/device/token',
    ])
    expect(Object.keys(doc.paths['/api/auth/device/code'] ?? {})).toEqual(['post'])
    expect(Object.keys(doc.paths['/api/auth/device/token'] ?? {})).toEqual(['post'])
    expect(doc.paths['/api/auth/device/code']?.post).toMatchObject({
      operationId: 'createDeviceAuthorization',
      tags: ['Downloader Device Flow'],
      security: [],
    })
    expect(doc.paths['/api/auth/device/token']?.post).toMatchObject({
      operationId: 'createDeviceAccessToken',
      tags: ['Downloader Device Flow'],
      security: [],
    })
    expect(
      doc.paths['/api/auth/device/token']?.post?.responses?.['200']?.content?.['application/json']?.schema?.properties,
    ).toMatchObject({
      access_token: { type: 'string' },
      token_type: { type: 'string' },
      expires_in: { type: 'integer' },
      scope: { type: 'string' },
    })
    expect(
      doc.paths['/api/auth/device/token']?.post?.responses?.['200']?.content?.['application/json']?.schema?.required,
    ).toEqual(['access_token', 'token_type', 'expires_in'])

    expect(doc.paths['/api/auth/sign-in/email']).toBeUndefined()
    expect(doc.paths['/api/auth/organization/create']).toBeUndefined()
    expect(doc.paths['/api/auth/admin/list-users']).toBeUndefined()
    expect(doc.paths['/api/auth/api-key/create']).toBeUndefined()
    expect(doc.components?.schemas?.Session).toBeUndefined()
    expect(doc.components?.schemas?.User).toBeUndefined()
    // The registered Better Auth operations need no imported components after
    // their declared normalization. ZPan's later framework-level response
    // decoration adds only the shared RequestId header reference.
    const requestIdReference = '#/components/headers/RequestId'
    for (const path of ['/api/auth/device/code', '/api/auth/device/token']) {
      const references = collectOpenApiReferences(doc.paths[path])
      expect(references.length).toBeGreaterThan(0)
      expect([...new Set(references)]).toEqual([requestIdReference])
      for (const reference of references) {
        expect(resolveLocalOpenApiReference(doc, reference)).toBe(doc.components?.headers?.RequestId)
      }
    }
    const operationIds = Object.values(doc.paths).flatMap((path) =>
      Object.values(path).flatMap((operation) =>
        operation && typeof operation === 'object' && 'operationId' in operation ? [operation.operationId] : [],
      ),
    )
    expect(operationIds.filter((id) => id === 'createDeviceAuthorization')).toHaveLength(1)
    expect(operationIds.filter((id) => id === 'createDeviceAccessToken')).toHaveLength(1)
  })

  it('keeps Better Auth runtime login, reference, and schema routes mounted', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [login, reference, schema] = await Promise.all([
      app.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'missing@example.com', password: 'wrong-password' }),
      }),
      app.request('/api/auth/reference'),
      app.request('/api/auth/open-api/generate-schema'),
    ])

    expect(login.status).not.toBe(404)
    expect(reference.status).toBe(200)
    expect(reference.headers.get('content-type')).toContain('text/html')
    expect(schema.status).toBe(200)
    await expect(schema.json()).resolves.toMatchObject({ paths: expect.any(Object) })
  })
})

function collectOpenApiReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectOpenApiReferences)
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  return [
    ...(typeof object.$ref === 'string' ? [object.$ref] : []),
    ...Object.values(object).flatMap(collectOpenApiReferences),
  ]
}

function resolveLocalOpenApiReference(document: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined
  return reference
    .slice(2)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, segment) => {
      if (!value || typeof value !== 'object') return undefined
      return (value as Record<string, unknown>)[segment]
    }, document)
}
