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
      'refreshDirectFileUploadParts',
      'completeDirectFileUpload',
      'abortDirectFileUpload',
    ])
    const workflowOperationIds = workflows.workflows
      ?.flatMap((workflow) => workflow.steps ?? [])
      .map((step) => step.operationId)
    expect(workflowOperationIds).toEqual([
      'createObject',
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

  it('publishes the external OAuth scope catalog without Restish profiles', async () => {
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

    expect(doc.components?.securitySchemes?.agentOAuth2).toMatchObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: '/api/auth/oauth2/authorize',
          tokenUrl: '/api/auth/oauth2/token',
          refreshUrl: '/api/auth/oauth2/token',
          scopes: expect.objectContaining({
            [AuthorizationScope.OBJECTS_READ]: 'List, inspect, and download objects',
            [AuthorizationScope.OBJECTS_CREATE]: 'Create folders and upload objects',
            [AuthorizationScope.SHARES_CREATE]: 'Create public shares',
          }),
        },
      },
    })
    expect(doc.components?.securitySchemes?.agentApiKey).toBeUndefined()
    expect(doc['x-cli-config']).toBeUndefined()
  })

  it('publishes a public resource-scope catalog for external controller discovery', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [catalogResponse, documentResponse] = await Promise.all([
      app.request('/api/oauth-resource-scopes'),
      app.request('/api/openapi.json'),
    ])
    const catalog = (await catalogResponse.json()) as {
      scopes: { value: string; description: string }[]
    }
    const document = (await documentResponse.json()) as {
      paths: Record<string, { get?: { security?: Record<string, string[]>[]; 'x-zpan-auth'?: unknown } }>
    }

    expect(catalogResponse.status).toBe(200)
    expect(catalog.scopes).toEqual(
      expect.arrayContaining([
        {
          value: AuthorizationScope.OBJECTS_CREATE,
          description: 'Create folders and upload objects',
        },
        {
          value: AuthorizationScope.OBJECTS_UPDATE,
          description: 'Rename, move, and copy objects',
        },
      ]),
    )
    expect(document.paths['/api/oauth-resource-scopes']?.get).toMatchObject({
      security: [
        {
          agentOAuth2: expect.arrayContaining([
            AuthorizationScope.OBJECTS_READ,
            AuthorizationScope.OBJECTS_CREATE,
            AuthorizationScope.OBJECTS_UPDATE,
          ]),
        },
        {},
      ],
      'x-zpan-auth': { public: true, scopes: [] },
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
      scopes_supported: expect.arrayContaining([AuthorizationScope.OBJECTS_READ]),
    })

    const protectedHead = await app.request('/.well-known/oauth-protected-resource/api', { method: 'HEAD' })
    expect(protectedHead.status).toBe(200)
  })

  it('serves HEAD for OAuth discovery and OpenID metadata endpoints', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const [authServer, openidConfig] = await Promise.all([
      app.request('/.well-known/oauth-authorization-server/api/auth', { method: 'HEAD' }),
      app.request('/.well-known/openid-configuration/api/auth', { method: 'HEAD' }),
    ])

    expect(authServer.status).toBe(200)
    expect(openidConfig.status).toBe(404)
    expect(await authServer.text()).toBe('')
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
      public: false,
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
      public: false,
      scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ],
      minTeamRole: 'viewer',
      siteRole: null,
      auditDenied: true,
    })
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

  it('leaves externally authorized operations unbound so delegated hooks can authenticate them', () => {
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

    expect(route.security).toBeUndefined()
  })

  it('hides non-agent scoped policies from MCP without hiding them from Restish', () => {
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
    ) as { security?: unknown; 'x-zpan-auth'?: unknown; 'x-cli-ignore'?: boolean; 'x-mcp-ignore'?: boolean }

    expect(adminRoute.security).toEqual([{ bearerAuth: [AuthorizationScope.SITE_ANALYTICS_READ] }, { cookieAuth: [] }])
    expect(adminRoute['x-zpan-auth']).toEqual({
      public: false,
      scopes: [AuthorizationScope.SITE_ANALYTICS_READ],
      minTeamRole: null,
      siteRole: 'admin',
      auditDenied: true,
    })
    expect(adminRoute['x-cli-ignore']).toBeUndefined()
    expect(adminRoute['x-mcp-ignore']).toBe(true)
  })

  it('detects OpenAPI operations missing explicit authorization declarations without an allowlist', () => {
    expect(
      findOperationsMissingAuthContract({
        '/public': { get: { 'x-zpan-auth': { public: true, scopes: [] } } },
        '/protected': { post: { 'x-zpan-auth': { public: false, scopes: ['objects:read'] } } },
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
      paths: Record<string, Record<string, { security?: unknown; 'x-zpan-auth'?: unknown; 'x-mcp-ignore'?: boolean }>>
    }

    const operation = doc.paths['/api/downloads/downloaders']?.post
    expect(operation?.security).toEqual([{ bearerAuth: [AuthorizationScope.DOWNLOADERS_CREATE] }, { cookieAuth: [] }])
    expect(operation?.['x-zpan-auth']).toEqual({
      public: false,
      scopes: [AuthorizationScope.DOWNLOADERS_CREATE],
      minTeamRole: null,
      siteRole: 'admin',
      auditDenied: true,
    })
    expect(operation?.['x-mcp-ignore']).toBe(true)
  })

  it('marks session, admin, and credential-management operations as ignored by MCP without hiding them from Restish', async () => {
    const { app } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    const res = await app.request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { 'x-cli-ignore'?: boolean; 'x-mcp-ignore'?: boolean }>>
    }

    const ignoredOperations = [
      doc.paths['/api/agent-oauth-grants']?.get,
      doc.paths['/api/agent-oauth-grants/{grantId}']?.delete,
      doc.paths['/api/site/storages']?.post,
      doc.paths['/api/auth/sign-in/email']?.post,
      doc.paths['/api/auth/sign-out']?.post,
    ]

    for (const operation of ignoredOperations) {
      expect(operation?.['x-mcp-ignore']).toBe(true)
      expect(operation?.['x-cli-ignore']).toBeUndefined()
    }
    expect(doc.paths['/api/auth/callback/{id}']?.get?.['x-mcp-ignore']).toBe(true)
    expect(doc.paths['/api/auth/callback/{id}']?.get?.['x-cli-ignore']).toBe(true)
    expect(doc.paths['/api/objects']?.get?.['x-mcp-ignore']).toBeUndefined()
    expect(Object.keys(doc.paths)).not.toContain('/api/openapi.agent.json')
    expect(await app.request('/api/openapi.agent.json')).toMatchObject({ status: 404 })
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
      'x-zpan-auth': {
        public: false,
        scopes: [AuthorizationScope.OBJECTS_CREATE],
      },
    })
    expect(doc.paths['/api/objects']?.post?.security).toBeUndefined()
    expect(doc.paths['/api/objects']?.post?.responses?.['201']).toBeDefined()
    expect(doc.paths['/api/objects']?.post?.requestBody).toBeDefined()
    expect(doc.paths['/api/objects']?.post?.requestBody?.content?.['application/json']?.schema).toMatchObject({
      required: ['name'],
      properties: {
        name: expect.any(Object),
        type: expect.any(Object),
        size: expect.any(Object),
        parent: expect.any(Object),
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
        public: false,
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
