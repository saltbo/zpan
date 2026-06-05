import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createMatterSchema } from '@shared/schemas'
import downloadTasks from '../routes/download-tasks'
import downloaders, { downloaderSelfRoute } from '../routes/downloaders'

const errorSchema = z.object({ error: z.string() }).openapi('ErrorResponse')

const deviceCodeRequestSchema = z
  .object({
    client_id: z.string(),
    scope: z.string(),
  })
  .openapi('DeviceCodeRequest')

const deviceCodeSchema = z
  .object({
    device_code: z.string(),
    user_code: z.string(),
    verification_uri: z.string(),
    verification_uri_complete: z.string(),
    expires_in: z.number().int(),
    interval: z.number().int(),
  })
  .openapi('DeviceCode')

const deviceTokenRequestSchema = z
  .object({
    grant_type: z.string(),
    device_code: z.string(),
    client_id: z.string(),
  })
  .openapi('DeviceTokenRequest')

const deviceTokenSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number().int(),
    scope: z.string(),
  })
  .openapi('DeviceToken')

const objectDraftSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    uploadUrl: z.string().optional(),
    contentDisposition: z.string().optional(),
  })
  .openapi('ObjectDraft')

const confirmObjectRequestSchema = z
  .object({
    action: z.enum(['confirm']),
    onConflict: z.enum(['fail', 'rename']).optional(),
  })
  .openapi('ConfirmObjectRequest')

const createObjectUploadSessionRequestSchema = z
  .object({
    partSize: z
      .number()
      .int()
      .min(5 * 1024 * 1024)
      .max(512 * 1024 * 1024)
      .optional(),
  })
  .openapi('CreateObjectUploadSessionRequest')

const objectUploadSessionSchema = z
  .object({
    id: z.string(),
    objectId: z.string(),
    uploadId: z.string(),
    partSize: z.number().int(),
    status: z.enum(['active', 'completed', 'aborted']),
    expiresAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ObjectUploadSession')

const presignObjectUploadPartsRequestSchema = z
  .object({
    partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
  })
  .openapi('PresignObjectUploadPartsRequest')

const presignedObjectUploadPartSchema = z
  .object({
    partNumber: z.number().int(),
    url: z.string(),
  })
  .openapi('PresignedObjectUploadPart')

const presignObjectUploadPartsResponseSchema = z
  .object({
    uploadId: z.string(),
    partSize: z.number().int(),
    parts: z.array(presignedObjectUploadPartSchema),
  })
  .openapi('PresignObjectUploadPartsResponse')

const completeObjectUploadSessionRequestSchema = z
  .object({
    action: z.literal('complete'),
    parts: z.array(z.object({ partNumber: z.number().int(), etag: z.string() })).min(1),
  })
  .openapi('CompleteObjectUploadSessionRequest')

const abortObjectUploadSessionRequestSchema = z
  .object({
    action: z.literal('abort'),
  })
  .openapi('AbortObjectUploadSessionRequest')

const patchObjectUploadSessionRequestSchema = z
  .union([completeObjectUploadSessionRequestSchema, abortObjectUploadSessionRequestSchema])
  .openapi('PatchObjectUploadSessionRequest')

function jsonResponse(schema: z.ZodType, description: string) {
  return {
    content: {
      'application/json': {
        schema,
      },
    },
    description,
  }
}

function mountBetterAuthDeviceRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/device/code',
      request: {
        body: {
          content: { 'application/json': { schema: deviceCodeRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(deviceCodeSchema, 'Device authorization code'),
      },
    }),
    (c) => c.json({} as z.infer<typeof deviceCodeSchema>, 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/device/token',
      request: {
        body: {
          content: { 'application/json': { schema: deviceTokenRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(deviceTokenSchema, 'Device access token'),
        400: jsonResponse(errorSchema, 'Device login error'),
      },
    }),
    (c) => c.json({} as z.infer<typeof deviceTokenSchema>, 200),
  )
}

function mountObjectUploadRoutes(app: OpenAPIHono) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/objects',
      request: {
        body: {
          content: { 'application/json': { schema: createMatterSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(objectDraftSchema, 'Object draft with upload URL'),
        201: jsonResponse(objectDraftSchema, 'Object draft with upload URL'),
        403: jsonResponse(errorSchema, 'Forbidden'),
        409: jsonResponse(errorSchema, 'Name conflict'),
      },
    }),
    (c) => c.json({} as z.infer<typeof objectDraftSchema>, 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/objects/{id}',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { 'application/json': { schema: confirmObjectRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(objectDraftSchema, 'Confirmed object'),
        403: jsonResponse(errorSchema, 'Forbidden'),
        404: jsonResponse(errorSchema, 'Not found'),
      },
    }),
    (c) => c.json({} as z.infer<typeof objectDraftSchema>, 200),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/objects/{id}/uploads',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { 'application/json': { schema: createObjectUploadSessionRequestSchema } },
          required: true,
        },
      },
      responses: {
        201: jsonResponse(objectUploadSessionSchema, 'Object multipart upload session'),
        400: jsonResponse(errorSchema, 'Invalid upload session'),
        403: jsonResponse(errorSchema, 'Forbidden'),
        404: jsonResponse(errorSchema, 'Not found'),
      },
    }),
    (c) => c.json({} as z.infer<typeof objectUploadSessionSchema>, 201),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/objects/{id}/uploads/{uploadSessionId}/parts',
      request: {
        params: z.object({ id: z.string(), uploadSessionId: z.string() }),
        body: {
          content: { 'application/json': { schema: presignObjectUploadPartsRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(presignObjectUploadPartsResponseSchema, 'Presigned multipart upload parts'),
        400: jsonResponse(errorSchema, 'Invalid upload session'),
        403: jsonResponse(errorSchema, 'Forbidden'),
        404: jsonResponse(errorSchema, 'Not found'),
      },
    }),
    (c) => c.json({} as z.infer<typeof presignObjectUploadPartsResponseSchema>, 200),
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/api/objects/{id}/uploads/{uploadSessionId}',
      request: {
        params: z.object({ id: z.string(), uploadSessionId: z.string() }),
        body: {
          content: { 'application/json': { schema: patchObjectUploadSessionRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonResponse(objectUploadSessionSchema, 'Updated object multipart upload session'),
        400: jsonResponse(errorSchema, 'Invalid upload session'),
        403: jsonResponse(errorSchema, 'Forbidden'),
        404: jsonResponse(errorSchema, 'Not found'),
      },
    }),
    (c) => c.json({} as z.infer<typeof objectUploadSessionSchema>, 200),
  )
}

export function createDownloaderOpenAPIApp() {
  const app = new OpenAPIHono()
  mountBetterAuthDeviceRoutes(app)
  app.route('/api/download-tasks', downloadTasks)
  app.route('/api/downloader', downloaderSelfRoute)
  app.route('/api/admin/downloaders', downloaders)
  mountObjectUploadRoutes(app)
  return app
}

export function downloaderOpenAPIDocument() {
  return createDownloaderOpenAPIApp().getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
      title: 'ZPan Downloader API',
      version: '0.1.0',
    },
  })
}
