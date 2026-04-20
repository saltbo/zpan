import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { saveShareRequestSchema } from '../../shared/schemas/share'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getMemberRole, isPersonalOrg } from '../services/org'
import { computeSourceBytes, isQuotaSufficient, resolveShareByToken, saveShareToDrive } from '../services/save-to-drive'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

const app = new Hono<Env>()
  .use(requireAuth)
  .post('/:token/save', zValidator('json', saveShareRequestSchema), async (c) => {
    const token = c.req.param('token')
    const { targetOrgId, targetParent } = c.req.valid('json')
    const currentUserId = c.get('userId')!
    const db = c.get('platform').db

    // 1. Resolve share — distinguish not_found/revoked from matter_trashed
    const resolution = await resolveShareByToken(db, token)
    if (resolution.status === 'matter_trashed') {
      return c.json({ error: 'Share target has been deleted' }, 410)
    }
    if (resolution.status !== 'ok') {
      return c.json({ error: 'Share not found' }, 404)
    }

    const { share, matter, recipients } = resolution

    // 2. Reject direct shares — they cannot be saved to drive
    if (share.kind === 'direct') {
      return c.json(
        {
          error: 'Direct link shares cannot be saved. Ask the sender for a landing share.',
          code: 'DIRECT_SAVE_FORBIDDEN',
        },
        400,
      )
    }

    // 3. Password-protected share: recipient is exempt; others need the cookie
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

    // 4. Verify current user has editor+ role in targetOrgId
    const role = await getMemberRole(db, targetOrgId, currentUserId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS.editor) {
        return c.json({ error: 'Forbidden' }, 403)
      }
    } else if (!(await isPersonalOrg(db, targetOrgId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    // 5. Pre-flight quota check (non-atomic fast-fail)
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
