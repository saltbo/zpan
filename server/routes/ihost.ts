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

const app = new Hono<Env>()

// ── POST /api/ihost/images ───────────────────────────────────────────────────
// Accepts session auth OR API key with image-hosting:upload permission.
// requireAuth is intentionally omitted — unauthenticated requests fall through
// to the API-key resolver below; 401 is returned there if neither auth method
// succeeds. Two content types are supported:
//   - application/json   → two-stage draft creation + presigned URL
//   - multipart/form-data → stream-proxy upload to R2 (PicGo-compatible)

app.post('/images', async (c) => {
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

  // ── Multipart: stream-proxy upload ────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    // NOTE: Hono's built-in multipart parser buffers the entire file in memory
    // before exposing it as a File object. This is a v2.4 known limitation.
    // The 20 MB cap below prevents OOM on CF Workers.
    const contentLength = Number(c.req.header('Content-Length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_SIZE) {
      return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
    }

    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    if (file.size > MAX_IMAGE_SIZE) {
      return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
    }

    const mime = file.type || 'application/octet-stream'
    if (mime === 'image/svg+xml') return c.json({ error: 'SVG images are not allowed' }, 415)
    if (!(ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime)) {
      return c.json({ error: 'Unsupported media type', allowedTypes: ALLOWED_IMAGE_MIMES }, 415)
    }

    const pathParam = formData.get('path')
    const requestedPath = typeof pathParam === 'string' && pathParam ? pathParam : deriveDefaultPath(file.name, mime)

    const pathErr = validatePath(requestedPath)
    if (pathErr) return c.json(pathErr, 400)

    const allowed = await incrementImageQuotaIfAllowed(db, orgId, storage.id, file.size)
    if (!allowed) return c.json({ error: 'Quota exceeded' }, 422)

    const row = await createImageHosting(db, {
      orgId,
      path: requestedPath,
      mime: mime as (typeof ALLOWED_IMAGE_MIMES)[number],
      size: file.size,
      storageId: storage.id,
      status: 'draft',
    })

    try {
      await s3.putObject(storage, row.storageKey, file.stream(), mime)
    } catch (err) {
      // S3 put failed — remove DB row and refund the quota we already incremented
      await db.delete(imageHostings).where(and(eq(imageHostings.id, row.id), eq(imageHostings.orgId, orgId)))
      await decrementImageQuota(db, orgId, storage.id, file.size)
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
  }

  // ── JSON: two-stage draft creation ────────────────────────────────────────
  if (!contentType.includes('application/json')) {
    return c.json({ error: 'Unsupported content type' }, 415)
  }

  const raw = await c.req.json()

  // Check MIME and size before zod so we return the correct HTTP status codes.
  const { mime: rawMime, size: rawSize } = raw as Record<string, unknown>
  if (typeof rawSize === 'number' && rawSize > MAX_IMAGE_SIZE) {
    return c.json({ error: 'File too large', maxBytes: MAX_IMAGE_SIZE }, 413)
  }
  if (rawMime === 'image/svg+xml') return c.json({ error: 'SVG images are not allowed' }, 415)
  if (typeof rawMime === 'string' && !(ALLOWED_IMAGE_MIMES as readonly string[]).includes(rawMime)) {
    return c.json({ error: 'Unsupported media type', allowedTypes: ALLOWED_IMAGE_MIMES }, 415)
  }

  const parseResult = createIhostImageSchema.safeParse(raw)
  if (!parseResult.success) {
    return c.json({ error: 'Invalid input', issues: parseResult.error.issues }, 400)
  }

  const { path: requestedPath, mime, size } = parseResult.data

  const pathErr = validatePath(requestedPath)
  if (pathErr) return c.json(pathErr, 400)

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
})

// ── Session-only routes ──────────────────────────────────────────────────────

app.get('/images', requireAuth, requireTeamRole('viewer'), zValidator('query', listIhostImagesSchema), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)

  const db = c.get('platform').db
  const config = await getImageHostingConfig(db, orgId)
  if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

  const { pathPrefix, cursor, limit } = c.req.valid('query')
  const result = await listImageHostings(db, orgId, { pathPrefix, cursor, limit })
  return c.json(result)
})

app.get('/images/:id', requireAuth, requireTeamRole('viewer'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)

  const db = c.get('platform').db
  const config = await getImageHostingConfig(db, orgId)
  if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

  const row = await getImageHosting(db, c.req.param('id'), orgId)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

app.patch(
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

    const { action } = c.req.valid('json')

    if (action === 'confirm') {
      const { row, quotaExceeded } = await confirmImageHosting(db, c.req.param('id'), orgId)
      if (quotaExceeded) return c.json({ error: 'Quota exceeded' }, 422)
      if (!row) return c.json({ error: 'Not found or not in draft status' }, 404)
      return c.json(row)
    }

    return c.json({ error: 'Unknown action' }, 400)
  },
)

app.delete('/images/:id', requireAuth, requireTeamRole('editor'), async (c) => {
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

// re-export for RPC type inference
export default app
