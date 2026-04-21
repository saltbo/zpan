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
import { apikey } from '../db/auth-schema'
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

// resolveApiKeyOrgId extracts the Bearer token, verifies it, and returns the
// orgId (= apikey.referenceId). Returns null if no Bearer token is present.
async function resolveApiKeyOrgId(
  c: Context<Env>,
  requiredPermission: string,
): Promise<{ orgId: string } | { error: string; status: 401 | 403 } | null> {
  const authHeader = c.req.raw.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const rawKey = authHeader.slice('Bearer '.length).trim()
  if (!rawKey) return null

  const db = c.get('platform').db
  const rows = await db.select().from(apikey).where(eq(apikey.key, rawKey)).limit(1)
  const keyRow = rows[0]
  if (!keyRow?.enabled) return { error: 'Invalid or disabled API key', status: 401 }
  if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
    return { error: 'API key expired', status: 401 }
  }

  const [resource, action] = requiredPermission.split(':')

  if (keyRow.permissions) {
    try {
      const statements = JSON.parse(keyRow.permissions) as Array<{
        resource: string
        actions: string[]
      }>
      const granted = statements.some((s) => s.resource === resource && s.actions.includes(action))
      if (!granted) return { error: 'API key missing required permission', status: 403 }
    } catch {
      return { error: 'API key has malformed permissions', status: 403 }
    }
  }
  // If permissions is null, the key was created with defaultPermissions which includes
  // image-hosting:upload — allow it.

  return { orgId: keyRow.referenceId }
}

const app = new Hono<Env>()

// ── POST /api/ihost/images ───────────────────────────────────────────────────
// Accepts session auth OR API key with image-hosting:upload permission.
// Two content types:
//   - application/json   → two-stage draft creation + presigned URL
//   - multipart/form-data → stream-proxy upload to R2 (PicGo-compatible)

app.post('/images', async (c) => {
  const db = c.get('platform').db
  const contentType = c.req.header('Content-Type') ?? ''

  // Resolve principal: session takes priority; fall back to API key
  let orgId = c.get('orgId')

  if (!orgId) {
    const apiKeyResult = await resolveApiKeyOrgId(c, 'image-hosting:upload')
    if (apiKeyResult === null) return c.json({ error: 'Unauthorized' }, 401)
    if ('error' in apiKeyResult) return c.json({ error: apiKeyResult.error }, apiKeyResult.status)
    orgId = apiKeyResult.orgId
  }

  const config = await getImageHostingConfig(db, orgId)
  if (!config) return c.json({ error: 'image hosting not enabled for this organization' }, 403)

  const storage = (await selectStorage(db, 'private')) as unknown as S3Storage

  // ── Multipart: stream-proxy upload ────────────────────────────────────────
  if (contentType.includes('multipart/form-data')) {
    // NOTE: Hono's built-in multipart parser buffers the entire file in memory
    // before exposing it as a File object. This is a v2.4 known limitation.
    // The 20 MB cap below prevents OOM on CF Workers.
    const contentLength = Number(c.req.header('Content-Length') ?? '0')
    if (contentLength > MAX_IMAGE_SIZE) {
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
  const parseResult = createIhostImageSchema.safeParse(await c.req.json())
  if (!parseResult.success) {
    return c.json({ error: 'Invalid input', issues: parseResult.error.issues }, 400)
  }

  const { path: requestedPath, mime, size } = parseResult.data

  if (mime === ('image/svg+xml' as string)) return c.json({ error: 'SVG images are not allowed' }, 415)

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

export default app
