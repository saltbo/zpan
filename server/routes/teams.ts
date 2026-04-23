import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { organization } from '../db/auth-schema'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listActivities } from '../services/activity'
import { deletePublicImageVariants, uploadPublicImage } from '../services/image-upload'
import { getMemberRole, isPersonalOrg } from '../services/org'
import { acceptInviteLink, createInviteLink, getInviteLinkInfo, listPendingInvitations } from '../services/team-invite'

const LOGO_PREFIX = '_system/org-logos'

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
  // ── Org logo (public-bucket image) ───────────────────────────────────────────
  .put('/:teamId/logo', async (c) => {
    const platform = c.get('platform')
    const userId = c.get('userId') as string
    const { teamId } = c.req.param()

    const role = await getMemberRole(platform.db, teamId, userId)
    if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'Expected multipart/form-data with a file field' }, 415)
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    const result = await uploadPublicImage(platform, LOGO_PREFIX, teamId, file)
    if (!result.ok) return c.json({ error: result.error }, result.status)

    await platform.db.update(organization).set({ logo: result.url }).where(eq(organization.id, teamId))
    return c.json({ url: result.url })
  })
  .delete('/:teamId/logo', async (c) => {
    const platform = c.get('platform')
    const userId = c.get('userId') as string
    const { teamId } = c.req.param()

    const role = await getMemberRole(platform.db, teamId, userId)
    if (role !== 'owner' && role !== 'admin') return c.json({ error: 'Forbidden' }, 403)

    await platform.db.update(organization).set({ logo: null }).where(eq(organization.id, teamId))
    await deletePublicImageVariants(platform, LOGO_PREFIX, teamId)
    return c.json({ ok: true })
  })
