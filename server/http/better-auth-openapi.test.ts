import { describe, expect, it } from 'vitest'
import { addDownloaderDeviceFlowOpenApi, DOWNLOADER_DEVICE_FLOW_TAG } from './better-auth-openapi'

describe('Downloader Device Flow OpenAPI boundary', () => {
  it('copies only the explicitly whitelisted path and POST method', () => {
    const doc: {
      paths: Record<string, { get?: Record<string, unknown>; post?: Record<string, unknown> }>
    } = { paths: { '/api/objects': { get: { operationId: 'listObjects' } } } }
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

    addDownloaderDeviceFlowOpenApi(doc, authDoc)

    expect(Object.keys(doc.paths)).toEqual(['/api/objects', '/api/auth/device/code', '/api/auth/device/token'])
    expect(Object.keys(doc.paths['/api/auth/device/code'])).toEqual(['post'])
    expect(Object.keys(doc.paths['/api/auth/device/token'])).toEqual(['post'])
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
  })

  it('fails closed when a whitelisted operation gains a component reference', () => {
    const doc = { paths: {} }
    const authDoc = {
      paths: {
        '/device/code': {
          post: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/DeviceCode' } } } },
            },
          },
        },
        '/device/token': {
          post: {
            responses: { '200': { content: { 'application/json': { schema: {} } } } },
          },
        },
      },
    }

    expect(() => addDownloaderDeviceFlowOpenApi(doc, authDoc)).toThrow(
      'Better Auth OpenAPI operation POST /device/code is not self-contained: #/components/schemas/DeviceCode',
    )
  })

  it('fails closed when a whitelisted operation is missing', () => {
    expect(() => addDownloaderDeviceFlowOpenApi({ paths: {} }, { paths: {} })).toThrow(
      'Better Auth OpenAPI is missing POST /device/code',
    )
  })

  it('fails closed when the device token success response is missing', () => {
    const authDoc = {
      paths: {
        '/device/code': { post: { responses: {} } },
        '/device/token': { post: { responses: {} } },
      },
    }

    expect(() => addDownloaderDeviceFlowOpenApi({ paths: {} }, authDoc)).toThrow(
      'Better Auth OpenAPI is missing the JSON 200 response for POST /device/token',
    )
  })
})
