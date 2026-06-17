import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { pageSchema } from '../../shared/schemas'
import { createShareRequestSchema, listSharesQuerySchema, saveShareRequestSchema } from '../../shared/schemas/share'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Matter, ShareListItem } from '../usecases/ports'
import {
  createShare,
  downloadShareObject,
  listShareObjects,
  listShares,
  revokeShare,
  type ShareCreatorDto,
  type ShareViewerDto,
  saveShare,
  verifySharePassword,
  viewShare,
} from '../usecases/share'
import { errorResponse, jsonBody, jsonContent } from './openapi'
import { cookieName, decodeChildRef, readUserId, viewCookieName } from './share-utils'

function shareUrls(kind: string, token: string): { landing?: string; direct?: string } {
  return kind === 'landing' ? { landing: `/s/${token}` } : { direct: `/r/${token}` }
}

const VIEW_DEDUP_TTL_SECS = 30
const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

// ─── Schemas ─────────────────────────────────────────────────────────────────
const shareViewSchema = z
  .object({
    token: z.string(),
    kind: z.string(),
    status: z.string(),
    expiresAt: z.string().nullable(),
    downloadLimit: z.number().int().nullable(),
    matter: z.object({
      name: z.string(),
      type: z.string(),
      size: z.number().int().nullable(),
      isFolder: z.boolean(),
    }),
    creatorName: z.string(),
    requiresPassword: z.boolean(),
    expired: z.boolean(),
    exhausted: z.boolean(),
    accessibleByUser: z.boolean(),
    downloads: z.number().int(),
    views: z.number().int(),
    rootRef: z.string(),
    // creator-only fields
    id: z.string().optional(),
    matterId: z.string().optional(),
    orgId: z.string().optional(),
    creatorId: z.string().optional(),
    createdAt: z.string().optional(),
    recipients: z.array(z.unknown()).optional(),
  })
  .openapi('ShareView')

function toShareViewDTO(dto: ShareViewerDto | ShareCreatorDto): z.infer<typeof shareViewSchema> {
  const base = {
    token: dto.token,
    kind: dto.kind,
    status: dto.status,
    expiresAt: dto.expiresAt ? dto.expiresAt.toISOString() : null,
    downloadLimit: dto.downloadLimit,
    matter: dto.matter,
    creatorName: dto.creatorName,
    requiresPassword: dto.requiresPassword,
    expired: dto.expired,
    exhausted: dto.exhausted,
    accessibleByUser: dto.accessibleByUser,
    downloads: dto.downloads,
    views: dto.views,
    rootRef: dto.rootRef,
  }
  if ('createdAt' in dto) {
    return {
      ...base,
      id: dto.id,
      matterId: dto.matterId,
      orgId: dto.orgId,
      creatorId: dto.creatorId,
      createdAt: dto.createdAt.toISOString(),
      recipients: dto.recipients,
    }
  }
  return base
}

const shareListItemSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    kind: z.string(),
    matterId: z.string(),
    orgId: z.string(),
    creatorId: z.string(),
    expiresAt: z.string().nullable(),
    downloadLimit: z.number().int().nullable(),
    views: z.number().int(),
    downloads: z.number().int(),
    status: z.string(),
    createdAt: z.string(),
    matter: z.object({ name: z.string(), type: z.string(), dirtype: z.number().int() }),
    recipientCount: z.number().int(),
    creatorName: z.string().optional(),
  })
  .openapi('ShareListItem')

function toShareListItemDTO(s: ShareListItem): z.infer<typeof shareListItemSchema> {
  return { ...s, expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null, createdAt: s.createdAt.toISOString() }
}

const shareListSchema = pageSchema(shareListItemSchema, 'ShareList')

const shareObjectsSchema = z
  .object({
    items: z.array(z.unknown()),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    breadcrumb: z.array(z.object({ name: z.string(), path: z.string() })),
  })
  .openapi('ShareObjects')

const createdShareSchema = z
  .object({
    token: z.string(),
    kind: z.string(),
    urls: z.object({ landing: z.string().optional(), direct: z.string().optional() }),
    expiresAt: z.string().nullable(),
    downloadLimit: z.number().int().nullable(),
  })
  .openapi('CreatedShare')

// `saved` carries full Matter records; serialized inline (the named `Matter`
// component is owned by the objects router).
const savedMatterSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  alias: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nullable(),
  dirtype: z.number().int().nullable(),
  parent: z.string(),
  object: z.string(),
  storageId: z.string(),
  status: z.string(),
  trashedAt: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

function toSavedMatterDTO(m: Matter): z.infer<typeof savedMatterSchema> {
  return { ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() }
}

const saveShareResultSchema = z
  .object({
    saved: z.array(savedMatterSchema),
    skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
  })
  .openapi('SaveShareResult')

const listObjectsQuerySchema = z.object({
  parent: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

const verifyPasswordSchema = z.object({ password: z.string() })

// ─── PUBLIC SEGMENT ──────────────────────────────────────────────────────────
const viewShareRoute = createRoute({
  operationId: 'getShare',
  summary: 'View a share',
  tags: ['Shares'],
  method: 'get',
  path: '/{token}',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonContent(shareViewSchema, 'Share'),
    404: errorResponse('Share not found or revoked'),
    410: errorResponse('File no longer available'),
  },
})

const verifyShareRoute = createRoute({
  operationId: 'verifySharePassword',
  summary: 'Verify a share password',
  tags: ['Shares'],
  method: 'post',
  path: '/{token}/sessions',
  request: { params: z.object({ token: z.string() }), ...jsonBody(verifyPasswordSchema) },
  responses: {
    200: jsonContent(z.object({ ok: z.literal(true) }), 'Verified'),
    403: errorResponse('Invalid password'),
    404: errorResponse('Share not found or revoked'),
  },
})

const listShareObjectsRoute = createRoute({
  operationId: 'listShareObjects',
  summary: 'List objects in a folder share',
  tags: ['Shares'],
  method: 'get',
  path: '/{token}/objects',
  request: { params: z.object({ token: z.string() }), query: listObjectsQuerySchema },
  responses: {
    200: jsonContent(shareObjectsSchema, 'Share objects'),
    400: errorResponse('Bad request'),
    401: errorResponse('Password required'),
    404: errorResponse('Share not found'),
    410: errorResponse('Share expired or unavailable'),
  },
})

const pub = new OpenAPIHono<Env>()

// GET /{token}/objects/{ref} resolves a download to a 302 redirect (or a presigned
// URL when ?downloadUrl=1). It is a redirect endpoint, not a JSON resource, so it
// stays a plain route, excluded from the OpenAPI document.
pub.get('/:token/objects/:ref', async (c) => {
  const token = c.req.param('token')
  const ref = c.req.param('ref')
  const returnUrl = c.req.query('downloadUrl') === '1'
  const viewerId = await readUserId(c)

  const out = await downloadShareObject(c.get('deps'), {
    token,
    matterId: decodeChildRef(token, ref),
    viewerId,
    accessCookie: getCookie(c, cookieName(token)),
    cloudBaseUrl: cloudBaseUrl(c),
  })
  if (out.ok) {
    if (returnUrl) {
      const res = c.json({ downloadUrl: out.url })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }
    const res = c.redirect(out.url, 302)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
  throw out.error
})

export const publicShares = pub
  .openapi(viewShareRoute, async (c) => {
    const token = c.req.valid('param').token
    const viewerId = await readUserId(c)
    const out = await viewShare(c.get('deps'), {
      token,
      viewerId,
      viewCookie: getCookie(c, viewCookieName(token)),
      accessCookie: getCookie(c, cookieName(token)),
    })
    if (out.ok) {
      if (out.setViewCookie) {
        setCookie(c, viewCookieName(token), 'seen', {
          httpOnly: true,
          sameSite: 'Lax',
          secure: true,
          maxAge: VIEW_DEDUP_TTL_SECS,
        })
      }
      return c.json(toShareViewDTO(out.dto), 200)
    }
    throw out.error
  })
  .openapi(verifyShareRoute, async (c) => {
    const token = c.req.valid('param').token
    const { password } = c.req.valid('json')
    const out = await verifySharePassword(c.get('deps'), { token, password })
    if (out.ok) {
      setCookie(c, cookieName(token), 'ok', {
        httpOnly: true,
        sameSite: 'Lax',
        secure: true,
        expires: out.setAccessCookieExpiry,
      })
      return c.json({ ok: true as const }, 200)
    }
    throw out.error
  })
  .openapi(listShareObjectsRoute, async (c) => {
    const token = c.req.valid('param').token
    const viewerId = await readUserId(c)
    const { parent: relativePath = '', page: rawPageStr = '1', pageSize: rawPageSizeStr = '50' } = c.req.valid('query')
    const rawPage = parseInt(rawPageStr, 10)
    const rawPageSize = parseInt(rawPageSizeStr, 10)
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage)
    const pageSize = Number.isNaN(rawPageSize) ? 50 : Math.min(200, Math.max(1, rawPageSize))

    const out = await listShareObjects(c.get('deps'), {
      token,
      viewerId,
      accessCookie: getCookie(c, cookieName(token)),
      relativePath,
      page,
      pageSize,
    })
    if (out.ok) return c.json(out.result, 200)
    throw out.error
  })

// ─── AUTHED SEGMENT ─────────────────────────────────────────────────────────
const listSharesRoute = createRoute({
  operationId: 'listShares',
  summary: 'List my shares',
  tags: ['Shares'],
  method: 'get',
  path: '/',
  request: { query: listSharesQuerySchema },
  responses: { 200: jsonContent(shareListSchema, 'Shares') },
})

const createShareRoute = createRoute({
  operationId: 'createShare',
  summary: 'Create a share',
  tags: ['Shares'],
  method: 'post',
  path: '/',
  middleware: [requireTeamRole('editor')] as const,
  request: jsonBody(createShareRequestSchema),
  responses: {
    201: jsonContent(createdShareSchema, 'Created share'),
    400: errorResponse('Invalid share configuration'),
    404: errorResponse('Matter not found'),
  },
})

const revokeShareRoute = createRoute({
  operationId: 'revokeShare',
  summary: 'Revoke a share',
  tags: ['Shares'],
  method: 'delete',
  path: '/{token}',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    204: { description: 'Revoked' },
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
  },
})

const saveShareRoute = createRoute({
  operationId: 'saveShare',
  summary: 'Save a share to my drive',
  tags: ['Shares'],
  method: 'post',
  path: '/{token}/objects',
  request: { params: z.object({ token: z.string() }), ...jsonBody(saveShareRequestSchema) },
  responses: {
    201: jsonContent(saveShareResultSchema, 'Saved'),
    400: errorResponse('Bad request'),
    401: errorResponse('Authentication required'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Share not found'),
    410: errorResponse('Share target deleted'),
    422: errorResponse('Quota exceeded'),
  },
})

const authedApp = new OpenAPIHono<Env>()
authedApp.use(requireAuth)

export const authedShares = authedApp
  .openapi(listSharesRoute, async (c) => {
    const userId = c.get('userId')!
    const { page, pageSize, status, box } = c.req.valid('query')
    const result = await listShares(c.get('deps'), { userId, box, page, pageSize, status })
    return c.json({ ...result, items: result.items.map(toShareListItemDTO) }, 200)
  })
  .openapi(createShareRoute, async (c) => {
    const out = await createShare(c.get('deps'), c.get('platform'), {
      orgId: c.get('orgId')!,
      userId: c.get('userId')!,
      input: c.req.valid('json'),
    })
    if (out.ok) {
      return c.json(
        {
          token: out.share.token,
          kind: out.share.kind,
          urls: shareUrls(out.share.kind, out.share.token),
          expiresAt: out.share.expiresAt ? out.share.expiresAt.toISOString() : null,
          downloadLimit: out.share.downloadLimit,
        },
        201,
      )
    }
    throw out.error
  })
  .openapi(revokeShareRoute, async (c) => {
    const out = await revokeShare(c.get('deps'), {
      token: c.req.valid('param').token,
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    if (out.ok) return c.body(null, 204)
    throw out.error
  })
  .openapi(saveShareRoute, async (c) => {
    const token = c.req.valid('param').token
    const { targetOrgId, targetParent } = c.req.valid('json')
    const out = await saveShare(c.get('deps'), {
      token,
      currentUserId: c.get('userId')!,
      targetOrgId,
      targetParent,
      accessCookie: getCookie(c, cookieName(token)),
    })
    if (out.ok) return c.json({ saved: out.result.saved.map(toSavedMatterDTO), skipped: out.result.skipped }, 201)
    throw out.error
  })
