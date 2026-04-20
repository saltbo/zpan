import { zValidator } from '@hono/zod-validator'
import { and, eq, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { DirType } from '../../shared/constants'
import type { Storage as S3Storage } from '../../shared/types'
import { user } from '../db/auth-schema'
import { matters } from '../db/schema'
import type { Env } from '../middleware/platform'
import { listMatters } from '../services/matter'
import {
  incrementDownloadsAtomic,
  incrementViews,
  isAccessibleByUser,
  resolveShareByToken,
  verifyPassword,
} from '../services/share'
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
} from './share-utils'

const app = new Hono<Env>()
  .get('/:token', async (c) => {
    const token = c.req.param('token')
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    await incrementViews(db, share.id)

    const userId = await readUserId(c)
    const accessibleByUser = userId ? isAccessibleByUser(recipients, userId) : false
    const cookieVal = getCookie(c, cookieName(token))
    const requiresPassword = !!(share.passwordHash && !accessibleByUser && cookieVal !== 'ok')
    const expired = !!(share.expiresAt && share.expiresAt < new Date())
    const exhausted = !!(share.downloadLimit != null && share.downloads >= share.downloadLimit)
    const isFolder = matter.dirtype !== DirType.FILE

    const creatorRows = await db.select({ name: user.name }).from(user).where(eq(user.id, share.creatorId))
    const creatorName = creatorRows[0]?.name ?? ''

    return c.json({
      kind: 'landing' as const,
      matterName: matter.name,
      matterType: matter.type,
      matterSize: matter.size,
      isFolder,
      requiresPassword,
      expired,
      exhausted,
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      downloads: share.downloads,
      views: share.views,
      creatorName,
      accessibleByUser,
    })
  })
  .post('/:token/verify', zValidator('json', z.object({ password: z.string() })), async (c) => {
    const token = c.req.param('token')
    const db = c.get('platform').db
    const { password } = c.req.valid('json')

    const resolved = await resolveShareByToken(db, token)
    if (resolved.status !== 'ok') return c.json({ error: 'Share not found or revoked' }, 404)

    const { share } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    if (!verifyPassword(share, password)) return c.json({ error: 'Invalid password' }, 401)

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
  .get('/:token/download', async (c) => {
    const token = c.req.param('token')
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)
    if (matter.dirtype !== DirType.FILE) return c.json({ error: 'Cannot download a folder directly' }, 400)

    const userId = await readUserId(c)
    const cookieVal = getCookie(c, cookieName(token))
    const gate = checkAccessGate(share.passwordHash, recipients, userId, cookieVal)
    if (gate === 'password_required') return c.json({ error: 'Password required' }, 401)

    if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

    const { ok } = await incrementDownloadsAtomic(db, share.id)
    if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

    const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const url = await s3.presignDownload(storage, matter.object, matter.name, PRESIGN_TTL_SECS)
    const res = c.redirect(url, 302)
    res.headers.set('Cache-Control', 'no-store')
    return res
  })
  .get('/:token/children', async (c) => {
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

    const userId = await readUserId(c)
    const cookieVal = getCookie(c, cookieName(token))
    const gate = checkAccessGate(share.passwordHash, recipients, userId, cookieVal)
    if (gate === 'password_required') return c.json({ error: 'Password required' }, 401)

    if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

    const relativePath = c.req.query('path') ?? ''
    if (relativePath.includes('..')) return c.json({ error: 'Invalid path' }, 400)

    const rawPage = parseInt(c.req.query('page') ?? '1', 10)
    const rawPageSize = parseInt(c.req.query('pageSize') ?? '50', 10)
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
      id: encodeChildRef(token, m.id),
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
  .get('/:token/download/:childRef', async (c) => {
    const token = c.req.param('token')
    const childRef = c.req.param('childRef')
    const db = c.get('platform').db

    const resolved = await resolveShareByToken(db, token)
    if (resolved.status !== 'ok') {
      if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
      return c.json({ error: 'Share not found or revoked' }, 404)
    }

    const { share, matter, recipients } = resolved
    if (share.kind !== 'landing') return c.json({ error: 'Share not found or revoked' }, 404)

    const matterId = decodeChildRef(token, childRef)
    if (!matterId) return c.json({ error: 'Invalid child reference' }, 400)

    const userId = await readUserId(c)
    const cookieVal = getCookie(c, cookieName(token))
    const gate = checkAccessGate(share.passwordHash, recipients, userId, cookieVal)
    if (gate === 'password_required') return c.json({ error: 'Password required' }, 401)

    if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

    const root = folderRootPath(matter)
    const likePattern = `${escapeLike(root)}/%`
    const childRows = await db
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

    const childMatter = childRows[0]
    if (!childMatter) return c.json({ error: 'File not found or not accessible' }, 404)

    const { ok } = await incrementDownloadsAtomic(db, share.id)
    if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

    const storage = (await getStorage(db, childMatter.storageId)) as unknown as S3Storage
    if (!storage) return c.json({ error: 'Storage not found' }, 404)

    const url = await s3.presignDownload(storage, childMatter.object, childMatter.name, PRESIGN_TTL_SECS)
    const res = c.redirect(url, 302)
    res.headers.set('Cache-Control', 'no-store')
    return res
  })

export default app
