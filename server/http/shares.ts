import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { createShareRequestSchema, listSharesQuerySchema, saveShareRequestSchema } from '../../shared/schemas/share'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  createShare,
  downloadShareObject,
  listShareObjects,
  listShares,
  revokeShare,
  saveShare,
  verifySharePassword,
  viewShare,
} from '../usecases/share'
import { cookieName, decodeChildRef, readUserId, viewCookieName } from './share-utils'

function shareUrls(kind: string, token: string): { landing?: string; direct?: string } {
  return kind === 'landing' ? { landing: `/s/${token}` } : { direct: `/r/${token}` }
}

const VIEW_DEDUP_TTL_SECS = 30

const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

// ─── PUBLIC SEGMENT ──────────────────────────────────────────────────────────
// Mounted at /api/shares BEFORE authMiddleware.

const listObjectsQuerySchema = z.object({
  parent: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

const verifyPasswordSchema = z.object({ password: z.string() })

export const publicShares = new Hono<Env>()
  .get('/:token', async (c) => {
    const token = c.req.param('token')
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
      return c.json(out.dto)
    }
    if (out.reason === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
    return c.json({ error: 'Share not found or revoked' }, 404)
  })
  .post('/:token/sessions', zValidator('json', verifyPasswordSchema), async (c) => {
    const token = c.req.param('token')
    const { password } = c.req.valid('json')

    const out = await verifySharePassword(c.get('deps'), { token, password })
    if (out.ok) {
      setCookie(c, cookieName(token), 'ok', {
        httpOnly: true,
        sameSite: 'Lax',
        secure: true,
        expires: out.setAccessCookieExpiry,
      })
      return c.json({ ok: true })
    }
    if (out.reason === 'invalid_password') return c.json({ error: 'Invalid password' }, 403)
    return c.json({ error: 'Share not found or revoked' }, 404)
  })
  .get('/:token/objects', zValidator('query', listObjectsQuerySchema), async (c) => {
    const token = c.req.param('token')
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
    if (out.ok) return c.json(out.result)
    switch (out.reason) {
      case 'matter_trashed':
        return c.json({ error: 'File no longer available' }, 410)
      case 'not_found':
        return c.json({ error: 'Share not found or revoked' }, 404)
      case 'not_a_folder':
        return c.json({ error: 'Not a folder share' }, 400)
      case 'password_required':
        return c.json({ error: 'Password required' }, 401)
      case 'expired':
        return c.json({ error: 'Share has expired' }, 410)
      case 'invalid_path':
        return c.json({ error: 'Invalid path' }, 400)
    }
  })
  .get('/:token/objects/:ref', async (c) => {
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
    switch (out.reason) {
      case 'matter_trashed':
        return c.json({ error: 'File no longer available' }, 410)
      case 'not_found':
        return c.json({ error: 'File not found or not accessible' }, 404)
      case 'invalid_ref':
        return c.json({ error: 'Invalid reference' }, 400)
      case 'password_required':
        return c.json({ error: 'Password required' }, 401)
      case 'expired':
        return c.json({ error: 'Share has expired' }, 410)
      case 'folder':
        return c.json({ error: 'Cannot download a folder directly' }, 400)
      case 'limit_exceeded':
        return c.json({ error: 'Download limit exceeded' }, 410)
      case 'storage_not_found':
        return c.json({ error: 'Storage not found' }, 404)
      case 'quota_exceeded':
        return c.json({ error: 'Traffic quota exceeded' }, 422)
      case 'insufficient_credits':
        return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
    }
  })

// ─── AUTHED SEGMENT ─────────────────────────────────────────────────────────
// Mounted at /api/shares AFTER authMiddleware.

export const authedShares = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listSharesQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const { page, pageSize, status, box } = c.req.valid('query')
    return c.json(await listShares(c.get('deps'), { userId, box, page, pageSize, status }))
  })
  .post('/', requireTeamRole('editor'), zValidator('json', createShareRequestSchema), async (c) => {
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
          expiresAt: out.share.expiresAt,
          downloadLimit: out.share.downloadLimit,
        },
        201,
      )
    }
    switch (out.reason) {
      case 'MATTER_NOT_FOUND':
        return c.json({ error: 'Matter not found', code: 'MATTER_NOT_FOUND' }, 404)
      case 'DIRECT_NO_FOLDER':
        return c.json({ error: 'Direct shares cannot be folders', code: 'DIRECT_NO_FOLDER' }, 400)
      case 'DIRECT_NO_PASSWORD':
        return c.json({ error: 'Direct shares cannot have a password', code: 'DIRECT_NO_PASSWORD' }, 400)
      case 'DIRECT_NO_RECIPIENTS':
        return c.json({ error: 'Direct shares cannot have recipients', code: 'DIRECT_NO_RECIPIENTS' }, 400)
    }
  })
  .delete('/:token', async (c) => {
    const out = await revokeShare(c.get('deps'), {
      token: c.req.param('token'),
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
    })
    if (out.ok) return new Response(null, { status: 204 })
    if (out.reason === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    return c.json({ error: 'Not found' }, 404)
  })
  .post('/:token/objects', zValidator('json', saveShareRequestSchema), async (c) => {
    const token = c.req.param('token')
    const { targetOrgId, targetParent } = c.req.valid('json')

    const out = await saveShare(c.get('deps'), {
      token,
      currentUserId: c.get('userId')!,
      targetOrgId,
      targetParent,
      accessCookie: getCookie(c, cookieName(token)),
    })
    if (out.ok) return c.json(out.result, 201)
    switch (out.reason) {
      case 'matter_trashed':
        return c.json({ error: 'Share target has been deleted' }, 410)
      case 'not_found':
        return c.json({ error: 'Share not found' }, 404)
      case 'direct_forbidden':
        return c.json(
          {
            error: 'Direct link shares cannot be saved. Ask the sender for a landing share.',
            code: 'DIRECT_SAVE_FORBIDDEN',
          },
          400,
        )
      case 'password_required':
        return c.json({ error: 'Authentication required for password-protected share' }, 401)
      case 'forbidden':
        return c.json({ error: 'Forbidden' }, 403)
      case 'quota_exceeded':
        return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 400)
    }
  })
