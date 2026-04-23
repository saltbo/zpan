import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { commitOrgLogoSchema, ORG_LOGO_MIMES, requestOrgLogoUploadSchema } from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { organization } from '../db/auth-schema'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listActivities } from '../services/activity'
import { getMemberRole, isPersonalOrg } from '../services/org'
import { S3Service } from '../services/s3'
import { selectStorage } from '../services/storage'
import { acceptInviteLink, createInviteLink, getInviteLinkInfo, listPendingInvitations } from '../services/team-invite'

const s3 = new S3Service()

const MIME_TO_EXT: Record<(typeof ORG_LOGO_MIMES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function orgLogoKey(orgId: string, mime: (typeof ORG_LOGO_MIMES)[number]): string {
  return `_system/org-logos/${orgId}.${MIME_TO_EXT[mime]}`
}

const createLinkSchema = z.object({
  role: z.enum(['editor', 'viewer']).default('viewer'),
  expiresIn: z.number().int().min(1).optional(), // milliseconds
})

const joinSchema = z.object({
  token: z.string().min(1),
})

const activityQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

export const publicTeams = new Hono<Env>().get(
  '/invite-info',
  zValidator('query', z.object({ token: z.string().min(1) })),
  async (c) => {
    const db = c.get('platform').db
    const { token } = c.req.valid('query')
    const info = await getInviteLinkInfo(db, token)
    if (!info) return c.json({ error: 'Invalid or expired invite link' }, 404)
    return c.json(info)
  },
)

export const teams = new Hono<Env>()
  .use(requireAuth)
  .post('/:teamId/invite-link', zValidator('json', createLinkSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { teamId } = c.req.param()
    const { role, expiresIn } = c.req.valid('json')

    const memberRole = await getMemberRole(db, teamId, userId)
    if (memberRole !== 'owner') return c.json({ error: 'Forbidden' }, 403)

    const link = await createInviteLink(db, teamId, userId, role, expiresIn)
    return c.json({ token: link.token, expiresAt: link.expiresAt }, 201)
  })
  .get('/:teamId/invitations', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { teamId } = c.req.param()

    const memberRole = await getMemberRole(db, teamId, userId)
    if (memberRole !== 'owner') return c.json({ error: 'Forbidden' }, 403)

    const invitations = await listPendingInvitations(db, teamId)
    return c.json({ invitations })
  })
  .post('/:teamId/members', zValidator('json', joinSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { token } = c.req.valid('json')

    const result = await acceptInviteLink(db, token, userId)
    if (result === 'invalid') return c.json({ error: 'Invalid invite link' }, 404)
    if (result === 'expired') return c.json({ error: 'Invite link has expired' }, 410)
    if (result === 'already_member') return c.json({ error: 'Already a member of this team' }, 409)

    return c.json({ ok: true })
  })
  .get('/:teamId/activity', zValidator('query', activityQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const teamId = c.req.param('teamId')
    const db = c.get('platform').db

    const role = await getMemberRole(db, teamId, userId)
    if (role === null && !(await isPersonalOrg(db, teamId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const { page: pageStr, pageSize: pageSizeStr } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const result = await listActivities(db, teamId, { page, pageSize })
    return c.json({ ...result, page, pageSize })
  })
  // ── Org Logo Upload ──────────────────────────────────────────────────────────
  // Stored in the workspace's public-mode S3 bucket so the URL is directly
  // embeddable. Mirrors the /api/profile/avatar flow.
  .post('/:teamId/logo', zValidator('json', requestOrgLogoUploadSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { teamId } = c.req.param()
    const { mime } = c.req.valid('json')

    const role = await getMemberRole(db, teamId, userId)
    if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'public')) as unknown as S3Storage
    } catch {
      return c.json({ error: 'No public storage configured for logos' }, 503)
    }

    const key = orgLogoKey(teamId, mime)
    const uploadUrl = await s3.presignUpload(storage, key, mime)
    return c.json({ uploadUrl, key }, 201)
  })
  .post('/:teamId/logo/commit', zValidator('json', commitOrgLogoSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { teamId } = c.req.param()
    const { mime } = c.req.valid('json')

    const role = await getMemberRole(db, teamId, userId)
    if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'public')) as unknown as S3Storage
    } catch {
      return c.json({ error: 'No public storage configured for logos' }, 503)
    }

    const key = orgLogoKey(teamId, mime)
    try {
      await s3.headObject(storage, key)
    } catch {
      return c.json({ error: 'Logo object not found. Upload the file first.' }, 400)
    }

    const logoUrl = s3.getPublicUrl(storage, key)
    await db.update(organization).set({ logo: logoUrl }).where(eq(organization.id, teamId))

    return c.json({ logo: logoUrl })
  })
  .delete('/:teamId/logo', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { teamId } = c.req.param()

    const role = await getMemberRole(db, teamId, userId)
    if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    await db.update(organization).set({ logo: null }).where(eq(organization.id, teamId))

    try {
      const storage = (await selectStorage(db, 'public')) as unknown as S3Storage
      await Promise.allSettled(ORG_LOGO_MIMES.map((mime) => s3.deleteObject(storage, orgLogoKey(teamId, mime))))
    } catch (err) {
      console.warn('[teams/logo delete] S3 cleanup skipped:', err)
    }

    return c.json({ ok: true })
  })
