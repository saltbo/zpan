import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { nanoid } from 'nanoid'
import {
  ALLOWED_IMAGE_MIMES,
  createIhostImageSchema,
  cursorPageSchema,
  ErrorReason,
  listIhostImagesSchema,
  MAX_IMAGE_SIZE,
} from '../../../shared/schemas'
import { buildImageUrl, validatePath } from '../../domain/image-hosting'
import { mapDomainError } from '../../lib/http-errors'
import { mimeToExt } from '../../lib/mime-utils'
import { requireAuth, requireTeamRole } from '../../middleware/auth'
import { requirePermission } from '../../middleware/authz'
import type { Env } from '../../middleware/platform'
import { decodeImageHostingCursor, encodeImageHostingCursor } from '../../usecases/image-hosting/cursor'
import {
  confirmImageHosting,
  getImageHosting,
  listImageHostings,
  presignImageHostingUpload,
  removeImageHosting,
  requireImageHostingEnabled,
  uploadImageHosting,
} from '../../usecases/image-hosting/images'
import {
  AppError,
  badRequest,
  type ImageHostingRecord,
  notFound,
  unauthorized,
  unsupportedMediaType,
} from '../../usecases/ports'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

// The stored image's wire shape — timestamps as ISO strings (the record carries
// them as Date).
const imageHostingSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    token: z.string(),
    path: z.string(),
    storageId: z.string(),
    storageKey: z.string(),
    size: z.number().int(),
    mime: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    status: z.string(),
    accessCount: z.number().int(),
    lastAccessedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ImageHosting')

type ImageHostingDTO = z.infer<typeof imageHostingSchema>

function toImageHostingDTO(r: ImageHostingRecord): ImageHostingDTO {
  return {
    ...r,
    lastAccessedAt: r.lastAccessedAt ? r.lastAccessedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }
}

const imageDraftSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    path: z.string(),
    uploadUrl: z.string(),
    storageKey: z.string(),
  })
  .openapi('ImageHostingDraft')

const imageListSchema = cursorPageSchema(imageHostingSchema, 'ImageHostingCursorPage')

// Derive a storage path from the upload's filename, falling back to a random name.
function deriveDefaultPath(filename: string, mime: string): string {
  if (!filename || filename === 'blob') return `image-${nanoid(8)}.${mimeToExt(mime)}`
  return filename.replace(/[/\\]/g, '_')
}

// Detect image MIME type from the first few bytes (magic numbers).
function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'
  return null
}

const presignRoute = createRoute({
  operationId: 'presignImageHostingUpload',
  summary: 'Presign an image upload',
  tags: ['Image Hosting'],
  method: 'post',
  path: '/images/presign',
  middleware: [requireAuth, requireTeamRole('editor')] as const,
  request: jsonBody(createIhostImageSchema),
  responses: {
    201: jsonContent(imageDraftSchema, 'Image upload draft'),
    400: errorResponse('No active organization or invalid path'),
    403: errorResponse('Image hosting not enabled'),
    413: errorResponse('File too large'),
    503: errorResponse('No storage configured'),
  },
})

const listRoute = createRoute({
  operationId: 'listImageHostings',
  summary: 'List hosted images',
  description:
    'Returns a live cursor page ordered by (createdAt, id). Inserts after the cursor are eligible for later pages; earlier inserts are not revisited.',
  tags: ['Image Hosting'],
  method: 'get',
  path: '/images',
  middleware: [requireAuth, requireTeamRole('viewer')] as const,
  request: { query: listIhostImagesSchema },
  responses: {
    200: jsonContent(imageListSchema, 'Hosted images'),
    400: errorResponse('No active organization or invalid cursor'),
    403: errorResponse('Image hosting not enabled'),
  },
})

const getRoute = createRoute({
  operationId: 'getImageHosting',
  summary: 'Get a hosted image',
  tags: ['Image Hosting'],
  method: 'get',
  path: '/images/{id}',
  middleware: [requireAuth, requireTeamRole('viewer')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(imageHostingSchema, 'Hosted image'),
    400: errorResponse('No active organization'),
    403: errorResponse('Image hosting not enabled'),
    404: errorResponse('Not found'),
  },
})

const confirmRoute = createRoute({
  operationId: 'confirmImageHosting',
  summary: 'Confirm an uploaded image',
  tags: ['Image Hosting'],
  method: 'put',
  path: '/images/{id}/status',
  middleware: [requireAuth, requireTeamRole('editor')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(imageHostingSchema, 'Confirmed image'),
    400: errorResponse('No active organization'),
    403: errorResponse('Image hosting not enabled'),
    404: errorResponse('Not found or not in draft status'),
    422: errorResponse('Quota exceeded'),
  },
})

const deleteRoute = createRoute({
  operationId: 'deleteImageHosting',
  summary: 'Delete a hosted image',
  tags: ['Image Hosting'],
  method: 'delete',
  path: '/images/{id}',
  middleware: [requireAuth, requireTeamRole('editor')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted' },
    400: errorResponse('No active organization'),
    403: errorResponse('Image hosting not enabled'),
    404: errorResponse('Not found'),
  },
})

const app = new OpenAPIHono<Env>()

// POST /images — external-tool upload endpoint (PicGo/ShareX multipart, uPic JSON
// base64). Tool-oriented and not RESTful, so it stays a plain route, excluded from
// the OpenAPI document / SDK. Registered as a statement so the `.openapi()` chain
// below keeps its typing.
app.post('/images', requirePermission('ihost', 'upload'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) throw unauthorized()

  const contentType = c.req.header('Content-Type') ?? ''
  const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
  if (!enabled.ok) throw enabled.error
  const config = enabled.config

  let fileBytes: Uint8Array
  let fileName: string
  let fileMime: string
  let explicitPath: string | null = null

  if (contentType.includes('application/json')) {
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      throw badRequest('Invalid JSON body')
    }
    const b64 = body.file
    if (typeof b64 !== 'string' || !b64) throw badRequest('file field (base64 string) is required')
    try {
      fileBytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    } catch {
      throw badRequest('Invalid base64 in file field')
    }
    fileName = typeof body.filename === 'string' && body.filename ? body.filename : 'upload'
    fileMime = detectMimeFromBytes(fileBytes) || 'application/octet-stream'
    if (typeof body.path === 'string' && body.path) explicitPath = body.path
  } else if (contentType.includes('multipart/form-data')) {
    const contentLength = Number(c.req.header('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE)
      throw new AppError(413, 'File exceeds the maximum allowed size', {
        reason: ErrorReason.PAYLOAD_TOO_LARGE,
        metadata: { maxBytes: String(MAX_IMAGE_SIZE) },
      })
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) throw badRequest('file field is required')
    fileBytes = new Uint8Array(await file.arrayBuffer())
    fileName = file.name || 'upload'
    fileMime = file.type || ''
    const pathParam = formData.get('path')
    if (typeof pathParam === 'string' && pathParam) explicitPath = pathParam
  } else {
    throw unsupportedMediaType('Unsupported Content-Type. Use multipart/form-data or application/json with base64.')
  }

  if (fileBytes.byteLength > MAX_IMAGE_SIZE)
    throw new AppError(413, 'File exceeds the maximum allowed size', {
      reason: ErrorReason.PAYLOAD_TOO_LARGE,
      metadata: { maxBytes: String(MAX_IMAGE_SIZE) },
    })

  let mime = fileMime
  if (!mime || mime === 'application/octet-stream') mime = detectMimeFromBytes(fileBytes) || ''
  if (!mime || mime === 'application/octet-stream') {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const extMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    }
    mime = (ext && extMap[ext]) || mime || 'application/octet-stream'
  }
  if (mime === 'image/svg+xml') throw unsupportedMediaType('SVG images are not allowed')
  if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime))
    throw new AppError(415, 'Unsupported media type', {
      reason: ErrorReason.UNSUPPORTED_MEDIA_TYPE,
      metadata: { allowedTypes: ALLOWED_IMAGE_MIMES.join(',') },
    })

  const requestedPath = explicitPath || deriveDefaultPath(fileName, mime)
  const pathErr = validatePath(requestedPath)
  if (pathErr) throw badRequest(`${pathErr.error}: ${pathErr.detail}`)

  try {
    const result = await uploadImageHosting(c.get('deps'), {
      orgId,
      path: requestedPath,
      mime: mime as (typeof ALLOWED_IMAGE_MIMES)[number],
      bytes: fileBytes,
    })
    if (!result.ok) throw result.error
    const row = result.row
    const origin = new URL(c.req.url).origin
    const tokenUrl = `${origin}/r/${row.token}`
    const url = buildImageUrl(config, row.path, tokenUrl)
    return c.json(
      {
        data: {
          url,
          urlAlt: tokenUrl,
          markdown: `![](${url})`,
          html: `<img src="${url}" />`,
          bbcode: `[img]${url}[/img]`,
        },
      },
      201,
    )
  } catch (err) {
    const mapped = mapDomainError(err)
    if (mapped) return c.json(mapped.json, mapped.status)
    throw err
  }
})

const ihost = app
  .openapi(presignRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) throw enabled.error

    const { path: requestedPath, mime, size } = c.req.valid('json')
    if (size > MAX_IMAGE_SIZE)
      throw new AppError(413, 'File exceeds the maximum allowed size', {
        reason: ErrorReason.PAYLOAD_TOO_LARGE,
        metadata: { maxBytes: String(MAX_IMAGE_SIZE) },
      })
    const pathErr = validatePath(requestedPath)
    if (pathErr) throw badRequest(`${pathErr.error}: ${pathErr.detail}`)

    const result = await presignImageHostingUpload(c.get('deps'), { orgId, path: requestedPath, mime, size })
    if (!result.ok) throw result.error
    return c.json(result.result, 201)
  })
  .openapi(listRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) throw enabled.error

    const { pathPrefix, cursor, limit } = c.req.valid('query')
    const result = await listImageHostings(c.get('deps'), orgId, {
      pathPrefix,
      cursor: cursor === undefined ? undefined : decodeImageHostingCursor(cursor),
      limit,
    })
    return c.json(
      {
        items: result.items.map(toImageHostingDTO),
        nextCursor: result.nextCursor ? encodeImageHostingCursor(result.nextCursor) : null,
      },
      200,
    )
  })
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) throw enabled.error

    const row = await getImageHosting(c.get('deps'), c.req.valid('param').id, orgId)
    if (!row) throw notFound()
    return c.json(toImageHostingDTO(row), 200)
  })
  .openapi(confirmRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) throw enabled.error

    const result = await confirmImageHosting(c.get('deps'), c.req.valid('param').id, orgId)
    if (!result.ok) throw result.error
    return c.json(toImageHostingDTO(result.row), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) throw enabled.error

    const deleted = await removeImageHosting(c.get('deps'), c.req.valid('param').id, orgId)
    if (!deleted) throw notFound()
    return c.body(null, 204)
  })

export default ihost
