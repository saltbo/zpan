import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { DirType } from '../../shared/constants'
import { createShareRequestSchema, listSharesQuerySchema, saveShareRequestSchema } from '../../shared/schemas/share'
import { isAccessibleByUser } from '../domain/share'
import { verifyPassword as verifyPasswordHash } from '../lib/password'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { CreateShareError, type ShareRecord } from '../usecases/ports'
import { saveShareToDrive } from '../usecases/save-to-drive'
import { dispatchShareCreated } from '../usecases/share-notification'
import {
  buildBreadcrumb,
  checkAccessGate,
  cookieName,
  decodeChildRef,
  encodeChildRef,
  folderRootPath,
  PRESIGN_TTL_SECS,
  readUserId,
  s3,
  viewCookieName,
} from './share-utils'
import { consumeAndReportDownloadTraffic } from './traffic-metering-utils'

function shareUrls(kind: string, token: string): { landing?: string; direct?: string } {
  return kind === 'landing' ? { landing: `/s/${token}` } : { direct: `/r/${token}` }
}

// ─── PUBLIC SEGMENT ──────────────────────────────────────────────────────────
// Mounted at /api/shares BEFORE authMiddleware.

const listObjectsQuerySchema = z.object({
  parent: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

const verifyPasswordSchema = z.object({ password: z.string() })
const VIEW_DEDUP_TTL_SECS = 30

export const publicShares = new Hono<Env>()
  .get('/:token', async (c) => {
    const token = c.req.param('token')

    const resolved = await c.get('deps').share.resolveByToken(token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    const viewerId = await readUserId(c)
    const isCreator = !!viewerId && viewerId === share.creatorId

    // Direct shares are not publicly viewable; only the creator sees metadata.
    if (share.kind !== 'landing' && !isCreator) {
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const viewCookie = getCookie(c, viewCookieName(token))
    if (!isCreator && viewCookie !== 'seen') {
      await c.get('deps').share.incrementViews(share.id)
      setCookie(c, viewCookieName(token), 'seen', {
        httpOnly: true,
        sameSite: 'Lax',
        secure: true,
        maxAge: VIEW_DEDUP_TTL_SECS,
      })
    }

    const accessibleByUser = viewerId ? isAccessibleByUser(recipients, viewerId) : false
    const cookieVal = getCookie(c, cookieName(token))
    const requiresPassword = !isCreator && !!(share.passwordHash && !accessibleByUser && cookieVal !== 'ok')
    const expired = !!(share.expiresAt && share.expiresAt < new Date())
    const exhausted = !!(share.downloadLimit != null && share.downloads >= share.downloadLimit)
    const isFolder = matter.dirtype !== DirType.FILE

    const creatorName = (await c.get('deps').share.getCreatorName(share.creatorId)) ?? ''

    const base = {
      token: share.token,
      kind: share.kind,
      status: share.status,
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      matter: { name: matter.name, type: matter.type, size: matter.size, isFolder },
      creatorName,
      requiresPassword,
      expired,
      exhausted,
      accessibleByUser,
      downloads: share.downloads,
      views: share.views,
      rootRef: encodeChildRef(token, matter.id),
    }

    if (isCreator) {
      return c.json({
        ...base,
        id: share.id,
        matterId: share.matterId,
        orgId: share.orgId,
        creatorId: share.creatorId,
        createdAt: share.createdAt,
        recipients,
      })
    }
    return c.json(base)
  })
  .post('/:token/sessions', zValidator('json', verifyPasswordSchema), async (c) => {
    const token = c.req.param('token')
    const { password } = c.req.valid('json')

    const resolved = await c.get('deps').share.resolveByToken(token)
    if (resolved.status !== 'ok') return c.json({ error: 'Share not found or revoked' }, 404)

    const { share } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    if (!share.passwordHash || !verifyPasswordHash(share.passwordHash, password))
      return c.json({ error: 'Invalid password' }, 403)

    const now = new Date()
    const oneDayMs = 24 * 60 * 60 * 1000
    const cookieExpiry = share.expiresAt
      ? new Date(Math.min(share.expiresAt.getTime(), now.getTime() + oneDayMs))
      : new Date(now.getTime() + oneDayMs)

    setCookie(c, cookieName(token), 'ok', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      expires: cookieExpiry,
    })

    return c.json({ ok: true })
  })
  .get('/:token/objects', zValidator('query', listObjectsQuerySchema), async (c) => {
    const token = c.req.param('token')

    const resolved = await c.get('deps').share.resolveByToken(token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)
    if (matter.dirtype === DirType.FILE) return c.json({ error: 'Not a folder share' }, 400)

    const viewerId = await readUserId(c)
    const cookieVal = getCookie(c, cookieName(token))
    const gate = checkAccessGate(share.passwordHash, recipients, viewerId, cookieVal)
    if (gate === 'password_required') return c.json({ error: 'Password required' }, 401)

    if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

    const { parent: relativePath = '', page: rawPageStr = '1', pageSize: rawPageSizeStr = '50' } = c.req.valid('query')
    if (relativePath.includes('..')) return c.json({ error: 'Invalid path' }, 400)

    const rawPage = parseInt(rawPageStr, 10)
    const rawPageSize = parseInt(rawPageSizeStr, 10)
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage)
    const pageSize = Number.isNaN(rawPageSize) ? 50 : Math.min(200, Math.max(1, rawPageSize))

    const root = folderRootPath(matter)
    const queryParent = relativePath ? `${root}/${relativePath}` : root

    const result = await c.get('deps').matter.list(matter.orgId, {
      parent: queryParent,
      status: 'active',
      page,
      pageSize,
    })

    const items = result.items.map((m) => ({
      ref: encodeChildRef(token, m.id),
      name: m.name,
      type: m.type,
      size: m.size,
      isFolder: m.dirtype !== DirType.FILE,
    }))

    return c.json({
      items,
      total: result.total,
      page,
      pageSize,
      breadcrumb: buildBreadcrumb(matter.name, relativePath),
    })
  })
  .get('/:token/objects/:ref', async (c) => {
    const token = c.req.param('token')
    const ref = c.req.param('ref')
    const returnUrl = c.req.query('downloadUrl') === '1'

    const resolved = await c.get('deps').share.resolveByToken(token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    const matterId = decodeChildRef(token, ref)
    if (!matterId) return c.json({ error: 'Invalid reference' }, 400)

    const viewerId = await readUserId(c)
    const cookieVal = getCookie(c, cookieName(token))
    const gate = checkAccessGate(share.passwordHash, recipients, viewerId, cookieVal)
    if (gate === 'password_required') return c.json({ error: 'Password required' }, 401)

    if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

    let targetMatter = matter
    if (matterId !== matter.id) {
      if (matter.dirtype === DirType.FILE) return c.json({ error: 'File not found or not accessible' }, 404)
      const child = await c.get('deps').share.findShareChildMatter(matter, matterId)
      if (!child) return c.json({ error: 'File not found or not accessible' }, 404)
      targetMatter = child
    } else if (matter.dirtype !== DirType.FILE) {
      return c.json({ error: 'Cannot download a folder directly' }, 400)
    }

    if (!(await c.get('deps').share.hasDownloadsAvailable(share.id)))
      return c.json({ error: 'Download limit exceeded' }, 410)

    const storage = await c.get('deps').storages.get(targetMatter.storageId)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const { ok } = await c.get('deps').share.incrementDownloadsAtomic(share.id)
    if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

    const trafficError = await consumeAndReportDownloadTraffic(c, {
      orgId: share.orgId,
      bytes: targetMatter.size ?? 0,
      storage,
      source: 'landing_share',
      sourceId: share.id,
      quotaExceeded: () => c.json({ error: 'Traffic quota exceeded' }, 422),
      onRejected: () => c.get('deps').share.decrementDownloads(share.id),
    })
    if (trafficError) return trafficError

    // Record download audit event. Use the authenticated viewer if available;
    // fall back to the share creator as the org-attributed actor for anonymous
    // downloads. The presigned URL is never stored in metadata.
    const actorId = viewerId ?? share.creatorId
    let url: string
    try {
      url = await s3.presignDownload(storage, targetMatter.object, targetMatter.name, PRESIGN_TTL_SECS)
    } catch (e) {
      await c.get('deps').quota.refundTraffic(share.orgId, targetMatter.size ?? 0)
      await c.get('deps').share.decrementDownloads(share.id)
      throw e
    }

    try {
      await c.get('deps').activity.record({
        orgId: share.orgId,
        userId: actorId,
        action: 'share_download',
        targetType: 'share',
        targetId: share.id,
        targetName: targetMatter.name,
        metadata: { anonymous: !viewerId },
      })
    } catch (error) {
      console.error('[shares] recordActivity failed:', error)
    }

    if (returnUrl) {
      const res = c.json({ downloadUrl: url })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    const res = c.redirect(url, 302)
    res.headers.set('Cache-Control', 'no-store')
    return res
  })

// ─── AUTHED SEGMENT ─────────────────────────────────────────────────────────
// Mounted at /api/shares AFTER authMiddleware.

export const authedShares = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listSharesQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const { page, pageSize, status, box } = c.req.valid('query')

    if (box === 'received') {
      const email = await c.get('deps').share.getUserEmail(userId)
      const result = await c.get('deps').share.listReceivedForApi(userId, email, { page, pageSize })
      return c.json({ ...result, page, pageSize })
    }

    const result = await c.get('deps').share.listForApi(userId, { page, pageSize, status })
    return c.json({ ...result, page, pageSize })
  })
  .post('/', requireTeamRole('editor'), zValidator('json', createShareRequestSchema), async (c) => {
    const orgId = c.get('orgId')!
    const userId = c.get('userId')!
    const body = c.req.valid('json')

    let expiresAt: Date | undefined
    if (body.expiresAt) expiresAt = new Date(body.expiresAt)

    const [creatorNameRaw, matterName] = await Promise.all([
      c.get('deps').share.getCreatorName(userId),
      c.get('deps').share.getMatterName(body.matterId),
    ])
    const creatorName = creatorNameRaw ?? 'Unknown'

    let share: ShareRecord
    try {
      share = await c.get('deps').share.create({
        matterId: body.matterId,
        orgId,
        creatorId: userId,
        kind: body.kind,
        password: body.password,
        expiresAt,
        downloadLimit: body.downloadLimit,
        recipients: body.recipients,
      })
    } catch (err) {
      if (err instanceof CreateShareError) {
        if (err.code === 'MATTER_NOT_FOUND') return c.json({ error: 'Matter not found', code: 'MATTER_NOT_FOUND' }, 404)
        if (err.code === 'DIRECT_NO_FOLDER')
          return c.json({ error: 'Direct shares cannot be folders', code: 'DIRECT_NO_FOLDER' }, 400)
        if (err.code === 'DIRECT_NO_PASSWORD')
          return c.json({ error: 'Direct shares cannot have a password', code: 'DIRECT_NO_PASSWORD' }, 400)
        if (err.code === 'DIRECT_NO_RECIPIENTS')
          return c.json({ error: 'Direct shares cannot have recipients', code: 'DIRECT_NO_RECIPIENTS' }, 400)
      }
      throw err
    }

    const resolvedMatterName = matterName ?? ''

    const recipients = body.recipients ?? []
    if (recipients.length > 0) {
      dispatchShareCreated(
        c.get('deps'),
        c.get('platform'),
        { id: share.id, token: share.token, kind: share.kind as 'landing' | 'direct', expiresAt: share.expiresAt },
        recipients,
        creatorName,
        resolvedMatterName,
      ).catch((err) => console.error('[shares] dispatchShareCreated failed:', err))
    }

    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'share_create',
      targetType: 'share',
      targetId: share.id,
      targetName: resolvedMatterName,
      metadata: { kind: share.kind, hasPassword: !!body.password, hasExpiry: !!body.expiresAt },
    })

    return c.json(
      {
        token: share.token,
        kind: share.kind,
        urls: shareUrls(share.kind, share.token),
        expiresAt: share.expiresAt,
        downloadLimit: share.downloadLimit,
      },
      201,
    )
  })
  .delete('/:token', async (c) => {
    const userId = c.get('userId')!
    const orgId = c.get('orgId')!
    const token = c.req.param('token')

    const creatorId = await c.get('deps').share.getCreatorByToken(token)
    if (creatorId === null) return c.json({ error: 'Not found' }, 404)
    if (creatorId !== userId) return c.json({ error: 'Forbidden' }, 403)

    // Race-safe: revokeByToken scopes the UPDATE to (token, creatorId).
    // A concurrent revoke or ownership change between the check above and this
    // call returns false — translate to 404 at the boundary.
    const revoked = await c.get('deps').share.revokeByToken(token, userId)
    if (!revoked) return c.json({ error: 'Not found' }, 404)

    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'share_revoke',
      targetType: 'share',
      targetName: token,
    })

    return new Response(null, { status: 204 })
  })
  .post('/:token/objects', zValidator('json', saveShareRequestSchema), async (c) => {
    const token = c.req.param('token')
    const { targetOrgId, targetParent } = c.req.valid('json')
    const currentUserId = c.get('userId')!
    const deps = c.get('deps')

    const resolution = await deps.share.resolveByToken(token)
    if (resolution.status === 'matter_trashed') {
      return c.json({ error: 'Share target has been deleted' }, 410)
    }
    if (resolution.status !== 'ok') {
      return c.json({ error: 'Share not found' }, 404)
    }

    const { share, matter, recipients } = resolution

    if (share.kind === 'direct') {
      return c.json(
        {
          error: 'Direct link shares cannot be saved. Ask the sender for a landing share.',
          code: 'DIRECT_SAVE_FORBIDDEN',
        },
        400,
      )
    }

    const gate = checkAccessGate(share.passwordHash, recipients, currentUserId, getCookie(c, cookieName(token)))
    if (gate === 'password_required') {
      return c.json({ error: 'Authentication required for password-protected share' }, 401)
    }

    if (!(await deps.org.canWriteToOrg(currentUserId, targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const totalBytes = await deps.share.computeSourceBytes(matter)
    const quotaOk = await deps.share.hasQuotaForBytes(targetOrgId, totalBytes)
    if (!quotaOk) {
      return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 400)
    }

    const result = await saveShareToDrive(deps, {
      share,
      matter,
      currentUserId,
      targetOrgId,
      targetParent,
    })
    return c.json(result, 201)
  })
