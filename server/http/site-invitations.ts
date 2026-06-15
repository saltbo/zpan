import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  createSiteInvitation,
  getSiteInvitationByToken,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
} from '../usecases/site-invitation'

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createSchema = z.object({
  email: z.string().email(),
})

export const adminSiteInvitations = new Hono<Env>()
  .use(requireAdmin)
  .get('/', zValidator('query', paginationSchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    return c.json(await listSiteInvitations(c.get('deps'), page, pageSize))
  })
  .post('/', zValidator('json', createSchema), async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const result = await createSiteInvitation(c.get('deps'), c.get('platform'), {
      userId,
      orgId: c.get('orgId')!,
      email: c.req.valid('json').email,
      requestUrl: c.req.url,
    })
    if (!result.ok) return c.json({ error: result.message }, 409)
    return c.json(result.invitation, 201)
  })
  .post('/:id/resend', async (c) => {
    const result = await resendSiteInvitation(c.get('deps'), c.get('platform'), {
      id: c.req.param('id'),
      requestUrl: c.req.url,
    })
    if (result.ok) return c.json(result.invitation)
    if (result.reason === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (result.reason === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    return c.json({ error: 'Invitation has been revoked' }, 400)
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const id = c.req.param('id')
    const result = await revokeSiteInvitation(c.get('deps'), { userId, orgId: c.get('orgId')!, id })
    if (result.ok) return c.json({ id, revoked: true })
    if (result.reason === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (result.reason === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    return c.json({ error: 'Invitation has already been revoked' }, 400)
  })

export const publicSiteInvitations = new Hono<Env>().get('/:token', async (c) => {
  const invitation = await getSiteInvitationByToken(c.get('deps'), c.req.param('token'))
  if (!invitation) return c.json({ error: 'Invitation not found' }, 404)
  return c.json(invitation)
})
