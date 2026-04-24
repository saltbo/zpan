import { zValidator } from '@hono/zod-validator'
import { and, eq, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { DirType } from '../../shared/constants'
import { createShareRequestSchema, listSharesQuerySchema, saveShareRequestSchema } from '../../shared/schemas/share'
import type { Storage as S3Storage } from '../../shared/types'
import { user } from '../db/auth-schema'
import { matters } from '../db/schema'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listMatters } from '../services/matter'
import { getMemberRole, isPersonalOrg } from '../services/org'
import {
  computeSourceBytes,
  isQuotaSufficient,
  saveShareToDrive as saveShareToDriveService,
} from '../services/save-to-drive'
import {
  createShare,
  getShareCreatorByToken,
  incrementDownloadsAtomic,
  incrementViews,
  isAccessibleByUser,
  listSharesForApi,
  resolveShareByToken,
  revokeShareByToken,
  verifyPassword,
} from '../services/share'
import { dispatchShareCreated } from '../services/share-notification'
import { getStorage } from '../services/storage'
import {
  buildBreadcrumb,
  checkAccessGate,
  cookieName,
  decodeChildRef,
  encodeChildRef,
  escapeLike,
  folderRootPath,
  PRESIGN_TTL_SECS,
  readUserId,
  s3,
  viewCookieName,
} from './share-utils'

const ROLE_LEVELS: Record<string, number> = { owner: 3, editor: 2, viewer: 1, member: 1 }

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
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
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
      await incrementViews(db, share.id)
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

    const creatorRows = await db.select({ name: user.name }).from(user).where(eq(user.id, share.creatorId))
    const creatorName = creatorRows[0]?.name ?? ''

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
    const db = c.get('platform').db
    const { password } = c.req.valid('json')

    const resolved = await resolveShareByToken(db, token)
    if (resolved.status !== 'ok') return c.json({ error: 'Share not found or revoked' }, 404)

    const { share } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    if (!verifyPassword(share, password)) return c.json({ error: 'Invalid password' }, 403)

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
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
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

    const result = await listMatters(db, matter.orgId, {
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
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
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
      const root = folderRootPath(matter)
      const likePattern = `${escapeLike(root)}/%`
      const rows = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.id, matterId),
            eq(matters.orgId, matter.orgId),
            eq(matters.status, 'active'),
            or(eq(matters.parent, root), sql`${matters.parent} LIKE ${likePattern} ESCAPE '\\'`),
          ),
        )
      const child = rows[0]
      if (!child) return c.json({ error: 'File not found or not accessible' }, 404)
      targetMatter = child
    } else if (matter.dirtype !== DirType.FILE) {
      return c.json({ error: 'Cannot download a folder directly' }, 400)
    }

    const { ok } = await incrementDownloadsAtomic(db, share.id)
    if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

    const storage = (await getStorage(db, targetMatter.storageId)) as unknown as S3Storage
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const url = await s3.presignDownload(storage, targetMatter.object, targetMatter.name, PRESIGN_TTL_SECS)
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
    const db = c.get('platform').db
    const { page, pageSize, status } = c.req.valid('query')

    const result = await listSharesForApi(db, userId, { page, pageSize, status })
    return c.json({ ...result, page, pageSize })
  })
  .post('/', requireTeamRole('editor'), zValidator('json', createShareRequestSchema), async (c) => {
    const orgId = c.get('orgId')!
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const body = c.req.valid('json')

    let expiresAt: Date | undefined
    if (body.expiresAt) expiresAt = new Date(body.expiresAt)

    const [creatorRow, matterRow] = await Promise.all([
      db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1),
      db.select({ name: matters.name }).from(matters).where(eq(matters.id, body.matterId)).limit(1),
    ])
    const creatorName = creatorRow[0]?.name ?? 'Unknown'
    const matterName = matterRow[0]?.name

    let share: Awaited<ReturnType<typeof createShare>>
    try {
      share = await createShare(db, {
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
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'MATTER_NOT_FOUND') return c.json({ error: 'Matter not found', code: 'MATTER_NOT_FOUND' }, 404)
      if (msg === 'DIRECT_NO_FOLDER')
        return c.json({ error: 'Direct shares cannot be folders', code: 'DIRECT_NO_FOLDER' }, 400)
      if (msg === 'DIRECT_NO_PASSWORD')
        return c.json({ error: 'Direct shares cannot have a password', code: 'DIRECT_NO_PASSWORD' }, 400)
      if (msg === 'DIRECT_NO_RECIPIENTS')
        return c.json({ error: 'Direct shares cannot have recipients', code: 'DIRECT_NO_RECIPIENTS' }, 400)
      throw err
    }

    const resolvedMatterName = matterName ?? ''

    const recipients = body.recipients ?? []
    if (recipients.length > 0) {
      dispatchShareCreated(db, share, recipients, creatorName, resolvedMatterName).catch((err) =>
        console.error('[shares] dispatchShareCreated failed:', err),
      )
    }

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
    const db = c.get('platform').db
    const token = c.req.param('token')

    const creatorId = await getShareCreatorByToken(db, token)
    if (creatorId === null) return c.json({ error: 'Not found' }, 404)
    if (creatorId !== userId) return c.json({ error: 'Forbidden' }, 403)

    // Race-safe: revokeShareByToken scopes the UPDATE to (token, creatorId).
    // A concurrent revoke or ownership change between the check above and this
    // call returns false — translate to 404 at the boundary.
    const revoked = await revokeShareByToken(db, token, userId)
    if (!revoked) return c.json({ error: 'Not found' }, 404)
    return new Response(null, { status: 204 })
  })
  .post('/:token/objects', zValidator('json', saveShareRequestSchema), async (c) => {
    const token = c.req.param('token')
    const { targetOrgId, targetParent } = c.req.valid('json')
    const currentUserId = c.get('userId')!
    const db = c.get('platform').db

    const resolution = await resolveShareByToken(db, token)
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

    const role = await getMemberRole(db, targetOrgId, currentUserId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS.editor) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    } else if (!(await isPersonalOrg(db, targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const state = await loadBindingState(db)
    const teamQuotaEnabled = hasFeature('team_quotas', state)

    if (teamQuotaEnabled) {
      const totalBytes = await computeSourceBytes(db, matter)
      const quotaOk = await isQuotaSufficient(db, targetOrgId, totalBytes)
      if (!quotaOk) {
        return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 400)
      }
    }

    const result = await saveShareToDriveService(db, {
      share,
      matter,
      currentUserId,
      targetOrgId,
      targetParent,
      teamQuotaEnabled,
    })
    return c.json(result, 201)
  })
