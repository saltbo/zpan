import { describe, expect, it } from 'vitest'
import {
  addRegisteredBetterAuthOpenApiOperations,
  type BetterAuthOpenApiOperationRegistration,
  DOWNLOADER_DEVICE_FLOW_TAG,
} from './better-auth-openapi'

type TestOperation = Record<string, unknown> & {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
}

type TestPathItem = {
  parameters?: unknown[]
  delete?: TestOperation
  get?: TestOperation
  patch?: TestOperation
  post?: TestOperation
  put?: TestOperation
}

type TestOpenApiDocument = {
  paths: Record<string, TestPathItem>
  components?: Record<string, Record<string, unknown>>
}

describe('Better Auth OpenAPI operation registry', () => {
  it('publishes only the registered Device Flow methods with their declared contract policy', () => {
    const doc: TestOpenApiDocument = { paths: { '/api/objects': { get: { operationId: 'listObjects' } } } }
    const authDoc = {
      paths: {
        '/device/code': {
          get: { operationId: 'futureDeviceCodeRead' },
          post: { operationId: 'upstreamDeviceCode', security: [{ bearerAuth: [] }], responses: {} },
        },
        '/device/token': {
          delete: { operationId: 'futureDeviceTokenDelete' },
          post: {
            operationId: 'upstreamDeviceToken',
            security: [{ bearerAuth: [] }],
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Session' } },
                },
              },
            },
          },
        },
        '/sign-in/email': { post: { operationId: 'signInEmail' } },
      },
      components: { schemas: { Session: {}, User: {} } },
    }

    addRegisteredBetterAuthOpenApiOperations(doc, authDoc)

    expect(Object.keys(doc.paths)).toEqual(['/api/objects', '/api/auth/device/code', '/api/auth/device/token'])
    expect(Object.keys(doc.paths['/api/auth/device/code'] ?? {})).toEqual(['post'])
    expect(Object.keys(doc.paths['/api/auth/device/token'] ?? {})).toEqual(['post'])
    expect(doc.paths['/api/auth/device/code'].post).toMatchObject({
      operationId: 'createDeviceAuthorization',
      tags: [DOWNLOADER_DEVICE_FLOW_TAG],
      security: [],
    })
    expect(doc.paths['/api/auth/device/token'].post).toMatchObject({
      operationId: 'createDeviceAccessToken',
      tags: [DOWNLOADER_DEVICE_FLOW_TAG],
      security: [],
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: {
                properties: {
                  access_token: { type: 'string' },
                  token_type: { type: 'string' },
                  expires_in: { type: 'integer' },
                  scope: { type: 'string' },
                },
                required: ['access_token', 'token_type', 'expires_in'],
              },
            },
          },
        },
      },
    })
    expect(doc.components?.schemas?.Session).toBeUndefined()
    expect(doc.components?.schemas?.User).toBeUndefined()
  })

  it('merges registered methods on one public path and applies security per operation', () => {
    const doc: TestOpenApiDocument = { paths: {} }
    const authDoc = {
      paths: {
        '/sessions': {
          get: { responses: {} },
          post: { responses: {} },
        },
      },
    }
    const registry = [
      registration({
        sourcePath: '/sessions',
        method: 'get',
        publicPath: '/api/auth/sessions',
        operationId: 'listAuthSessions',
        tags: ['Auth Sessions'],
        security: { mode: 'requirements', requirements: [{ cookieAuth: [] }, { bearerAuth: [] }] },
      }),
      registration({
        sourcePath: '/sessions',
        method: 'post',
        publicPath: '/api/auth/sessions',
        operationId: 'createAuthSession',
        tags: ['Auth Session Creation'],
        security: { mode: 'public' },
      }),
    ]

    addRegisteredBetterAuthOpenApiOperations(doc, authDoc, registry)

    expect(Object.keys(doc.paths['/api/auth/sessions'] ?? {})).toEqual(['get', 'post'])
    expect(doc.paths['/api/auth/sessions'].get).toMatchObject({
      operationId: 'listAuthSessions',
      tags: ['Auth Sessions'],
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    })
    expect(doc.paths['/api/auth/sessions'].post).toMatchObject({
      operationId: 'createAuthSession',
      tags: ['Auth Session Creation'],
      security: [],
    })
  })

  it('copies path-item parameters and their reachable component closure', () => {
    const doc: TestOpenApiDocument = { paths: {}, components: { schemas: { Existing: { type: 'string' } } } }
    const authDoc = {
      paths: {
        '/devices/{deviceId}': {
          parameters: [{ $ref: '#/components/parameters/DeviceId' }],
          get: { responses: {} },
        },
      },
      components: {
        parameters: {
          DeviceId: {
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: { $ref: '#/components/schemas/DeviceIdentifier' },
          },
        },
        schemas: {
          DeviceIdentifier: { type: 'string', pattern: '^device_' },
          Unrelated: { type: 'object' },
        },
      },
    }

    addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [
      registration({ sourcePath: '/devices/{deviceId}', method: 'get', publicPath: '/api/auth/devices/{deviceId}' }),
    ])

    expect(doc.paths['/api/auth/devices/{deviceId}'].parameters).toEqual([{ $ref: '#/components/parameters/DeviceId' }])
    expect(doc.components).toEqual({
      parameters: { DeviceId: authDoc.components.parameters.DeviceId },
      schemas: {
        Existing: { type: 'string' },
        DeviceIdentifier: authDoc.components.schemas.DeviceIdentifier,
      },
    })
  })

  it('copies only the transitive component closure and handles circular references', () => {
    const doc: TestOpenApiDocument = { paths: {} }
    const authDoc = {
      paths: {
        '/source': {
          post: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Root' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          Root: { type: 'object', properties: { child: { $ref: '#/components/schemas/Child' } } },
          Child: { type: 'object', properties: { parent: { $ref: '#/components/schemas/Root' } } },
          Session: { type: 'object' },
          User: { type: 'object' },
        },
      },
    }

    addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [registration()])

    expect(Object.keys(doc.components?.schemas ?? {}).sort()).toEqual(['Child', 'Root'])
    expect(doc.components?.schemas).toMatchObject({
      Root: authDoc.components.schemas.Root,
      Child: authDoc.components.schemas.Child,
    })
  })

  it('fails closed when a registered source operation is missing and names its actual method', () => {
    const doc: TestOpenApiDocument = { paths: {} }
    const registry = [registration({ sourcePath: '/source', method: 'delete', operationId: 'deleteAuthSession' })]

    expect(() => addRegisteredBetterAuthOpenApiOperations(doc, { paths: {} }, registry)).toThrow(
      'Better Auth OpenAPI is missing DELETE /source',
    )
    expect(doc).toEqual({ paths: {} })
  })

  it('rejects duplicate source and target registrations before aggregation', () => {
    const sourceDuplicate = [
      registration(),
      registration({ publicPath: '/api/auth/other', operationId: 'createOther' }),
    ]
    const targetDuplicate = [registration(), registration({ sourcePath: '/other', operationId: 'createOther' })]

    expect(() => addRegisteredBetterAuthOpenApiOperations({ paths: {} }, { paths: {} }, sourceDuplicate)).toThrow(
      'Duplicate Better Auth OpenAPI source registration: POST /source',
    )
    expect(() => addRegisteredBetterAuthOpenApiOperations({ paths: {} }, { paths: {} }, targetDuplicate)).toThrow(
      'Duplicate Better Auth OpenAPI target registration: POST /api/auth/source',
    )
  })

  it('rejects duplicate registry and existing-document operationIds', () => {
    const duplicateRegistry = [registration(), registration({ sourcePath: '/other', publicPath: '/api/auth/other' })]
    expect(() => addRegisteredBetterAuthOpenApiOperations({ paths: {} }, { paths: {} }, duplicateRegistry)).toThrow(
      'Duplicate Better Auth OpenAPI operationId registration: createAuthSource',
    )

    const doc = { paths: { '/api/existing': { get: { operationId: 'createAuthSource' } } } }
    const authDoc = { paths: { '/source': { post: { responses: {} } } } }
    expect(() => addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [registration()])).toThrow(
      'OpenAPI operationId createAuthSource conflicts between GET /api/existing and POST /api/auth/source',
    )
    expect(doc).toEqual({ paths: { '/api/existing': { get: { operationId: 'createAuthSource' } } } })
  })

  it('rejects an existing target method without overwriting it', () => {
    const doc = { paths: { '/api/auth/source': { post: { operationId: 'existingSource' } } } }
    const authDoc = { paths: { '/source': { post: { responses: {} } } } }

    expect(() => addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [registration()])).toThrow(
      'OpenAPI target already defines POST /api/auth/source',
    )
    expect(doc.paths['/api/auth/source'].post).toEqual({ operationId: 'existingSource' })
  })

  it('rejects conflicting target path parameters', () => {
    const doc = {
      paths: {
        '/api/auth/source': {
          parameters: [{ name: 'tenantId', in: 'path' }],
          get: { operationId: 'getExistingSource' },
        },
      },
    }
    const authDoc = {
      paths: {
        '/source': {
          parameters: [{ name: 'sourceId', in: 'path' }],
          post: { responses: {} },
        },
      },
    }

    expect(() => addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [registration()])).toThrow(
      'OpenAPI path parameters conflict at /api/auth/source',
    )
  })

  it('rejects a reachable component collision', () => {
    const doc = { paths: {}, components: { schemas: { Shared: { type: 'integer' } } } }
    const authDoc = {
      paths: {
        '/source': {
          post: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } } },
            },
          },
        },
      },
      components: { schemas: { Shared: { type: 'string' } } },
    }

    expect(() => addRegisteredBetterAuthOpenApiOperations(doc, authDoc, [registration()])).toThrow(
      'OpenAPI component collision at #/components/schemas/Shared',
    )
    expect(doc.components.schemas.Shared).toEqual({ type: 'integer' })
  })

  it.each([
    ['dangling local', '#/components/schemas/Missing', 'has a dangling reference'],
    [
      'external',
      'https://example.com/schema.json',
      'external reference https://example.com/schema.json is not allowed',
    ],
    ['non-component local', '#/paths/~1other', 'must target a component'],
  ])('rejects %s references', (_name, reference, error) => {
    const authDoc = {
      paths: {
        '/source': {
          post: {
            responses: { '200': { content: { 'application/json': { schema: { $ref: reference } } } } },
          },
        },
      },
    }

    expect(() => addRegisteredBetterAuthOpenApiOperations({ paths: {} }, authDoc, [registration()])).toThrow(error)
  })

  it('uses a registry-declared response schema override before resolving references', () => {
    const doc: TestOpenApiDocument = { paths: {} }
    const authDoc = {
      paths: {
        '/source': {
          post: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Incorrect' } } } },
            },
          },
        },
      },
      components: { schemas: { Incorrect: { type: 'object' } } },
    }
    const registry = [
      registration({
        contract: {
          responseSchemas: {
            '200': { 'application/json': { type: 'object', required: ['access_token'] } },
          },
        },
      }),
    ]

    addRegisteredBetterAuthOpenApiOperations(doc, authDoc, registry)

    expect(doc.paths['/api/auth/source']?.post?.responses?.['200']?.content?.['application/json']?.schema).toEqual({
      type: 'object',
      required: ['access_token'],
    })
    expect(doc.components?.schemas?.Incorrect).toBeUndefined()
  })

  it('fails closed when a declared response schema override cannot be applied', () => {
    const authDoc = { paths: { '/source': { post: { responses: {} } } } }
    const registry = [
      registration({
        contract: { responseSchemas: { '201': { 'application/problem+json': { type: 'object' } } } },
      }),
    ]

    expect(() => addRegisteredBetterAuthOpenApiOperations({ paths: {} }, authDoc, registry)).toThrow(
      'Better Auth OpenAPI cannot apply the 201 application/problem+json response schema override for POST /source',
    )
  })
})

function registration(
  overrides: Partial<BetterAuthOpenApiOperationRegistration> = {},
): BetterAuthOpenApiOperationRegistration {
  return {
    sourcePath: '/source',
    method: 'post',
    publicPath: '/api/auth/source',
    operationId: 'createAuthSource',
    tags: ['Auth Sources'],
    security: { mode: 'public' },
    ...overrides,
  }
}
