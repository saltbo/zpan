import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import {
  ALLOWED_IMAGE_MIMES,
  createIhostImageSchema,
  listIhostImagesSchema,
  MAX_IMAGE_SIZE,
} from '../../../shared/schemas'
import { buildImageUrl, validatePath } from '../../domain/image-hosting'
import { mapDomainError } from '../../lib/http-errors'
import { mimeToExt } from '../../lib/mime-utils'
import { requireAuth, requireTeamRole } from '../../middleware/auth'
import { requirePermission } from '../../middleware/authz'
import type { Env } from '../../middleware/platform'
import {
  confirmImageHosting,
  getImageHosting,
  listImageHostings,
  presignImageHostingUpload,
  removeImageHosting,
  requireImageHostingEnabled,
  uploadImageHosting,
} from '../../usecases/image-hosting/images'

// Derive a storage path from the upload's filename, falling back to a random
// name when the client sends an opaque blob.
function deriveDefaultPath(filename: string, mime: string): string {
  if (!filename || filename === 'blob') return `image-${nanoid(8)}.${mimeToExt(mime)}`
  // Strip path separators from the filename for safety
  return filename.replace(/[/\\]/g, '_')
}

// Detect image MIME type from the first few bytes (magic numbers)
function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  // WEBP: 52 49 46 46 ... 57 45 42 50
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

// ── POST /api/ihost/images ───────────────────────────────────────────────────
// Upload endpoint for external tools. Accepts two formats:
// 1. multipart/form-data — PicGo, ShareX (file in form field)
// 2. application/json — uPic (base64-encoded file in {"file": "..."})
// Accepts session auth OR API key with ihost:upload permission.
// requireAuth is intentionally omitted — unauthenticated requests fall through
// to the API-key resolver below; 401 is returned there if neither auth method
// succeeds.

const app = new Hono<Env>()
  .post('/images', requirePermission('ihost', 'upload'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const contentType = c.req.header('Content-Type') ?? ''

    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)
    const config = enabled.config

    // Parse the upload from either multipart/form-data or JSON base64.
    // uPic sends JSON: {"file": "<base64>"}; PicGo/ShareX send multipart.
    let fileBytes: Uint8Array
    let fileName: string
    let fileMime: string
    let explicitPath: string | null = null

    if (contentType.includes('application/json')) {
      let body: Record<string, unknown>
      try {
        body = (await c.req.json()) as Record<string, unknown>
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
      }
      const b64 = body.file
      if (typeof b64 !== 'string' || !b64) {
        return c.json({ error: 'file field (base64 string) is required' }, 400)
      }
      try {
        fileBytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
      } catch {
        return c.json({ error: 'Invalid base64 in file field' }, 400)
      }
      fileName = typeof body.filename === 'string' && body.filename ? body.filename : 'upload'
      fileMime = detectMimeFromBytes(fileBytes) || 'application/octet-stream'
      if (typeof body.path === 'string' && body.path) {
        explicitPath = body.path
      }
    } else if (contentType.includes('multipart/form-data')) {
      const contentLength = Number(c.req.header('Content-Length') ?? '0')
      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE) {
        return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
      }
      const formData = await c.req.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)
      fileBytes = new Uint8Array(await file.arrayBuffer())
      fileName = file.name || 'upload'
      fileMime = file.type || ''
      const pathParam = formData.get('path')
      if (typeof pathParam === 'string' && pathParam) {
        explicitPath = pathParam
      }
    } else {
      return c.json(
        { error: 'Unsupported Content-Type. Use multipart/form-data or application/json with base64.' },
        415,
      )
    }

    if (fileBytes.byteLength > MAX_IMAGE_SIZE) {
      return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
    }

    // Infer MIME from magic bytes or file extension when the client doesn't set it
    let mime = fileMime
    if (!mime || mime === 'application/octet-stream') {
      mime = detectMimeFromBytes(fileBytes) || ''
    }
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
    if (mime === 'image/svg+xml') return c.json({ error: 'SVG images are not allowed' }, 415)
    if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)) {
      return c.json({ error: 'Unsupported media type', allowedTypes: ALLOWED_IMAGE_MIMES }, 415)
    }

    const requestedPath = explicitPath || deriveDefaultPath(fileName, mime)
    const pathErr = validatePath(requestedPath)
    if (pathErr) return c.json(pathErr, 400)

    try {
      const result = await uploadImageHosting(c.get('deps'), {
        orgId,
        path: requestedPath,
        mime: mime as (typeof ALLOWED_IMAGE_MIMES)[number],
        bytes: fileBytes,
      })
      if (!result.ok) return c.json({ error: 'No storage configured' }, 503)
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

  // ── POST /api/ihost/images/presign ─────────────────────────────────────────
  // Typed JSON presign endpoint used by the browser client.
  // Creates a draft image record and returns a presigned S3 upload URL.
  // Follow up with PATCH /images/:id to confirm after uploading to S3.
  .post(
    '/images/presign',
    requireAuth,
    requireTeamRole('editor'),
    zValidator('json', createIhostImageSchema),
    async (c) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
      if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

      const { path: requestedPath, mime, size } = c.req.valid('json')

      if (size > MAX_IMAGE_SIZE) {
        return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
      }

      const pathErr = validatePath(requestedPath)
      if (pathErr) return c.json(pathErr, 400)

      const result = await presignImageHostingUpload(c.get('deps'), { orgId, path: requestedPath, mime, size })
      if (!result.ok) return c.json({ error: 'No storage configured' }, 503)

      return c.json(result.result, 201)
    },
  )

  // ── Session-only routes ────────────────────────────────────────────────────

  .get('/images', requireAuth, requireTeamRole('viewer'), zValidator('query', listIhostImagesSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const { pathPrefix, cursor, limit } = c.req.valid('query')
    const result = await listImageHostings(c.get('deps'), orgId, { pathPrefix, cursor, limit })
    return c.json(result)
  })

  .get('/images/:id', requireAuth, requireTeamRole('viewer'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const row = await getImageHosting(c.get('deps'), c.req.param('id'), orgId)
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  })

  .put('/images/:id/status', requireAuth, requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    // The only transition is confirming a freshly-uploaded draft (→ active).
    const { row, quotaExceeded } = await confirmImageHosting(c.get('deps'), c.req.param('id'), orgId)
    if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
    if (!row) return c.json({ error: 'Not found or not in draft status' }, 404)
    return c.json(row)
  })

  .delete('/images/:id', requireAuth, requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const enabled = await requireImageHostingEnabled(c.get('deps'), orgId)
    if (!enabled.ok) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const deleted = await removeImageHosting(c.get('deps'), c.req.param('id'), orgId)
    if (!deleted) return c.json({ error: 'Not found' }, 404)

    return new Response(null, { status: 204 })
  })

export default app
