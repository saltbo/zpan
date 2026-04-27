import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SiteInvitation } from '../../shared/types'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { getEmailConfig, sendEmail } from '../services/email'
import {
  createSiteInvitation,
  getSiteInvitationByToken,
  getSiteName,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
} from '../services/site-invitations'

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const createSchema = z.object({
  email: z.string().email(),
})

function buildSignupInviteEmailHtml(data: { siteName: string; inviteLink: string; expiresAt: string }) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">You're invited to register on ${data.siteName}</h2>
<p style="color:#555;line-height:1.5">The administrator invited you to create an account on <strong>${data.siteName}</strong>.</p>
<a href="${data.inviteLink}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Create Account</a>
<p style="color:#999;font-size:13px">This invitation expires on ${new Date(data.expiresAt).toLocaleDateString()}.</p>
</div>`
}

async function sendSiteInvitationEmail(
  db: Database,
  requestUrl: string,
  email: string,
  token: string,
  expiresAt: string,
) {
  const siteName = await getSiteName(db)
  const inviteLink = new URL('/sign-up', requestUrl)
  inviteLink.searchParams.set('invite', token)
  await sendEmail(db, {
    to: email,
    subject: `You're invited to register on ${siteName}`,
    html: buildSignupInviteEmailHtml({ siteName, inviteLink: inviteLink.toString(), expiresAt }),
  })
}

export const adminSiteInvitations = new Hono<Env>()
  .use(requireAdmin)
  .get('/', zValidator('query', paginationSchema), async (c) => {
    const db = c.get('platform').db
    const { page, pageSize } = c.req.valid('query')
    const result = await listSiteInvitations(db, page, pageSize)
    return c.json(result)
  })
  .post('/', zValidator('json', createSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const { email } = c.req.valid('json')
    await getEmailConfig(db)
    let invitation: SiteInvitation
    try {
      invitation = await createSiteInvitation(db, userId, email)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create invitation'
      return c.json({ error: message }, 409)
    }
    await sendSiteInvitationEmail(db, c.req.url, invitation.email, invitation.token, invitation.expiresAt)
    return c.json(invitation, 201)
  })
  .post('/:id/resend', async (c) => {
    const db = c.get('platform').db
    const id = c.req.param('id')
    const invitation = await resendSiteInvitation(db, id)

    if (invitation === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (invitation === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    if (invitation === 'already_revoked') return c.json({ error: 'Invitation has been revoked' }, 400)

    await getEmailConfig(db)
    await sendSiteInvitationEmail(db, c.req.url, invitation.email, invitation.token, invitation.expiresAt)
    return c.json(invitation)
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)

    const id = c.req.param('id')
    const result = await revokeSiteInvitation(db, id, userId)
    if (result === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (result === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    if (result === 'already_revoked') return c.json({ error: 'Invitation has already been revoked' }, 400)
    return c.json({ id, revoked: true })
  })

export const publicSiteInvitations = new Hono<Env>().get('/:token', async (c) => {
  const db = c.get('platform').db
  const token = c.req.param('token')
  const invitation = await getSiteInvitationByToken(db, token)
  if (!invitation) return c.json({ error: 'Invitation not found' }, 404)
  return c.json(invitation)
})
