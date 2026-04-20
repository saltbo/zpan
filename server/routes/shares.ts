import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { createShareRequestSchema, listSharesQuerySchema, saveShareRequestSchema } from '../../shared/schemas/share'
import { user } from '../db/auth-schema'
import { matters } from '../db/schema'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getMemberRole, isPersonalOrg } from '../services/org'
import { computeSourceBytes, isQuotaSufficient, saveShareToDrive } from '../services/save-to-drive'
import { createShare, getShareById, listSharesForApi, resolveShareByToken, revokeShare } from '../services/share'
import { dispatchShareCreated } from '../services/share-notification'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

function shareUrls(kind: string, token: string): { landing?: string; direct?: string } {
  if (kind === 'landing') return { landing: `/s/${token}` }
  return { direct: `/dl/${token}` }
}

const app = new Hono<Env>()
  .use(requireAuth)
  .post('/', requireTeamRole('editor'), zValidator('json', createShareRequestSchema), async (c) => {
    const orgId = c.get('orgId')!
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const body = c.req.valid('json')

    let expiresAt: Date | undefined
    if (body.expiresAt) expiresAt = new Date(body.expiresAt)

    // Pre-fetch creator name and matter name to avoid extra queries after createShare
    const [creatorRow, matterRow] = await Promise.all([
      db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1),
      db.select({ name: matters.name }).from(matters).where(eq(matters.id, body.matterId)).limit(1),
    ])
    // Missing user is a data integrity violation — do not silently use a raw ID
    const creatorName = creatorRow[0]?.name ?? 'Unknown'
    // matterRow may be undefined if matterId is invalid; createShare validates and throws MATTER_NOT_FOUND
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

    // createShare succeeded — matter is guaranteed valid; matterName fallback is unreachable in practice
    const resolvedMatterName = matterName ?? ''

    // Fire-and-forget: do not block response on notification dispatch
    const recipients = body.recipients ?? []
    if (recipients.length > 0) {
      dispatchShareCreated(db, share, recipients, creatorName, resolvedMatterName).catch((err) =>
        console.error('[shares] dispatchShareCreated failed:', err),
      )
    }

    return c.json(
      {
        id: share.id,
        token: share.token,
        kind: share.kind,
        urls: shareUrls(share.kind, share.token),
        expiresAt: share.expiresAt,
        downloadLimit: share.downloadLimit,
      },
      201,
    )
  })
  .get('/', zValidator('query', listSharesQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const { page, pageSize, status } = c.req.valid('query')

    const result = await listSharesForApi(db, userId, { page, pageSize, status })
    return c.json({ ...result, page, pageSize })
  })
  .get('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const { id } = c.req.param()

    const share = await getShareById(db, id)
    if (!share || share.creatorId !== userId) return c.json({ error: 'Not found' }, 404)

    return c.json(share)
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId')!
    const db = c.get('platform').db
    const { id } = c.req.param()

    const share = await getShareById(db, id)
    if (!share) return c.json({ error: 'Not found' }, 404)
    if (share.creatorId !== userId) return c.json({ error: 'Forbidden' }, 403)

    await revokeShare(db, id, userId)

    return new Response(null, { status: 204 })
  })
  .post('/:token/save', zValidator('json', saveShareRequestSchema), async (c) => {
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

    if (share.passwordHash) {
      const isRecipient = recipients.some(
        (r: { recipientUserId: string | null }) => r.recipientUserId === currentUserId,
      )
      if (!isRecipient) {
        const cookieValue = getCookie(c, `sharetk_${token}`)
        if (!cookieValue) {
          return c.json({ error: 'Authentication required for password-protected share' }, 401)
        }
      }
    }

    const role = await getMemberRole(db, targetOrgId, currentUserId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS.editor) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    } else if (!(await isPersonalOrg(db, targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const totalBytes = await computeSourceBytes(db, matter)
    const quotaOk = await isQuotaSufficient(db, targetOrgId, totalBytes)
    if (!quotaOk) {
      return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 400)
    }

    const result = await saveShareToDrive(db, {
      share,
      matter,
      currentUserId,
      targetOrgId,
      targetParent,
    })

    return c.json(result, 201)
  })

export default app
