import { zValidator } from '@hono/zod-validator'
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  ALLOWED_IMAGE_MIMES,
  createIhostImageSchema,
  listIhostImagesSchema,
  MAX_IMAGE_SIZE,
  patchIhostImageSchema,
} from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { imageHostings } from '../db/schema'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  buildImageUrl,
  confirmImageHosting,
  createImageHosting,
  decrementImageQuota,
  deleteImageHosting,
  deriveDefaultPath,
  getImageHosting,
  getImageHostingConfig,
  incrementImageQuotaIfAllowed,
  listImageHostings,
  validatePath,
} from '../services/image-hosting'
import { S3Service } from '../services/s3'
import { getStorage, selectStorage } from '../services/storage'
import { PRESIGN_TTL_SECS } from './share-utils'

const s3 = new S3Service()

// resolveApiKeyOrgId extracts the Bearer token, verifies it via the
// better-auth API-key plugin, and returns the orgId (= apikey.referenceId).
// Returns null if no Bearer token is present, or an error object if invalid.
// Invalid key and insufficient permissions both return 401 — the plugin does
// not distinguish them in its response.
async function resolveApiKeyOrgId(
  c: Context<Env>,
  resource: string,
  action: string,
): Promise<{ orgId: string } | { error: string; status: 401 } | null> {
  const authHeader = c.req.raw.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const rawKey = authHeader.slice('Bearer '.length).trim()
  if (!rawKey) return null

  const auth = c.get('auth')
  try {
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API not fully typed
    const result = (await (auth.api as any).verifyApiKey({
      body: { key: rawKey, permissions: { [resource]: [action] } },
    })) as {
      valid: boolean
      error: { message: string; code: string } | null
      key: { referenceId: string } | null
    }
    if (!result?.valid || !result.key) {
      return { error: result?.error?.message ?? 'Invalid or unauthorized API key', status: 401 }
    }
    return { orgId: result.key.referenceId }
  } catch {
    return { error: 'Invalid API key', status: 401 }
  }
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
// Accepts session auth OR API key with image-hosting:upload permission.
// requireAuth is intentionally omitted — unauthenticated requests fall through
// to the API-key resolver below; 401 is returned there if neither auth method
// succeeds.

const app = new Hono<Env>()
  .post('/images', async (c) => {
    const db = c.get('platform').db
    const contentType = c.req.header('Content-Type') ?? ''

    // Resolve principal: session takes priority; fall back to API key
    let orgId = c.get('orgId')

    if (!orgId) {
      const apiKeyResult = await resolveApiKeyOrgId(c, 'image-hosting', 'upload')
      if (apiKeyResult === null) return c.json({ error: 'Unauthorized' }, 401)
      if ('error' in apiKeyResult) return c.json({ error: apiKeyResult.error }, apiKeyResult.status)
      orgId = apiKeyResult.orgId
    }

    const config = await getImageHostingConfig(db, orgId)
    if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'private')) as unknown as S3Storage
    } catch {
      return c.json({ error: 'No storage configured' }, 503)
    }

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

    const allowed = await incrementImageQuotaIfAllowed(db, orgId, storage.id, fileBytes.byteLength)
    if (!allowed) return c.json({ error: 'Quota exceeded' }, 422)

    const row = await createImageHosting(db, {
      orgId,
      path: requestedPath,
      mime: mime as (typeof ALLOWED_IMAGE_MIMES)[number],
      size: fileBytes.byteLength,
      storageId: storage.id,
      status: 'draft',
    })

    try {
      await s3.putObject(storage, row.storageKey, fileBytes, mime)
    } catch (err) {
      // S3 put failed — remove DB row and refund the quota we already incremented
      await db.delete(imageHostings).where(and(eq(imageHostings.id, row.id), eq(imageHostings.orgId, orgId)))
      await decrementImageQuota(db, orgId, storage.id, fileBytes.byteLength)
      throw err
    }

    await db
      .update(imageHostings)
      .set({ status: 'active' })
      .where(and(eq(imageHostings.id, row.id), eq(imageHostings.orgId, orgId)))

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

      const db = c.get('platform').db
      const config = await getImageHostingConfig(db, orgId)
      if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

      const { path: requestedPath, mime, size } = c.req.valid('json')

      if (size > MAX_IMAGE_SIZE) {
        return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
      }

      const pathErr = validatePath(requestedPath)
      if (pathErr) return c.json(pathErr, 400)

      let storage: S3Storage
      try {
        storage = (await selectStorage(db, 'private')) as unknown as S3Storage
      } catch {
        return c.json({ error: 'No storage configured' }, 503)
      }

      const row = await createImageHosting(db, {
        orgId,
        path: requestedPath,
        mime,
        size,
        storageId: storage.id,
        status: 'draft',
      })

      const uploadUrl = await s3.presignUpload(storage, row.storageKey, mime, PRESIGN_TTL_SECS)

      return c.json(
        {
          id: row.id,
          token: row.token,
          path: row.path,
          uploadUrl,
          storageKey: row.storageKey,
        },
        201,
      )
    },
  )

  // ── Session-only routes ────────────────────────────────────────────────────

  .get('/images', requireAuth, requireTeamRole('viewer'), zValidator('query', listIhostImagesSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const config = await getImageHostingConfig(db, orgId)
    if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const { pathPrefix, cursor, limit } = c.req.valid('query')
    const result = await listImageHostings(db, orgId, { pathPrefix, cursor, limit })
    return c.json(result)
  })

  .get('/images/:id', requireAuth, requireTeamRole('viewer'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const config = await getImageHostingConfig(db, orgId)
    if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const row = await getImageHosting(db, c.req.param('id'), orgId)
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(row)
  })

  .patch(
    '/images/:id',
    requireAuth,
    requireTeamRole('editor'),
    zValidator('json', patchIhostImageSchema),
    async (c) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      const db = c.get('platform').db
      const config = await getImageHostingConfig(db, orgId)
      if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

      // action === 'confirm' is the only value the discriminated union allows
      const { row, quotaExceeded } = await confirmImageHosting(db, c.req.param('id'), orgId)
      if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
      if (!row) return c.json({ error: 'Not found or not in draft status' }, 404)
      return c.json(row)
    },
  )

  .delete('/images/:id', requireAuth, requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const db = c.get('platform').db
    const config = await getImageHostingConfig(db, orgId)
    if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

    const existing = await getImageHosting(db, c.req.param('id'), orgId)
    if (!existing) return c.json({ error: 'Not found' }, 404)

    const storage = await getStorage(db, existing.storageId)
    if (storage) {
      try {
        await s3.deleteObject(storage as unknown as S3Storage, existing.storageKey)
      } catch {
        // Best-effort S3 delete — proceed with DB cleanup regardless
      }
    }

    await deleteImageHosting(db, existing.id, orgId)

    return new Response(null, { status: 204 })
  })

export default app
