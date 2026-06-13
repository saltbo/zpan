import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SiteInvitation } from '../../shared/types'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { Platform } from '../platform/interface'
import type { EmailGateway } from '../usecases/ports'

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
  email: EmailGateway,
  platform: Platform,
  siteName: string,
  requestUrl: string,
  to: string,
  token: string,
  expiresAt: string,
) {
  const inviteLink = new URL('/sign-up', requestUrl)
  inviteLink.searchParams.set('invite', token)
  await email.send(platform, {
    to,
    subject: `You're invited to register on ${siteName}`,
    html: buildSignupInviteEmailHtml({ siteName, inviteLink: inviteLink.toString(), expiresAt }),
  })
}

export const adminSiteInvitations = new Hono<Env>()
  .use(requireAdmin)
  .get('/', zValidator('query', paginationSchema), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const result = await c.get('deps').siteInvitations.listSiteInvitations(page, pageSize)
    return c.json(result)
  })
  .post('/', zValidator('json', createSchema), async (c) => {
    const platform = c.get('platform')
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const orgId = c.get('orgId')!

    const { email } = c.req.valid('json')
    await c.get('deps').email.getConfig(platform)
    let invitation: SiteInvitation
    try {
      invitation = await c.get('deps').siteInvitations.createSiteInvitation(userId, email)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create invitation'
      return c.json({ error: message }, 409)
    }
    await sendSiteInvitationEmail(
      c.get('deps').email,
      platform,
      await c.get('deps').siteInvitations.getSiteName(),
      c.req.url,
      invitation.email,
      invitation.token,
      invitation.expiresAt,
    )
    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'site_invitation_create',
      targetType: 'site_invitation',
      targetId: invitation.id,
      targetName: invitation.email,
    })
    return c.json(invitation, 201)
  })
  .post('/:id/resend', async (c) => {
    const platform = c.get('platform')
    const id = c.req.param('id')
    const invitation = await c.get('deps').siteInvitations.resendSiteInvitation(id)

    if (invitation === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (invitation === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    if (invitation === 'already_revoked') return c.json({ error: 'Invitation has been revoked' }, 400)

    await c.get('deps').email.getConfig(platform)
    await sendSiteInvitationEmail(
      c.get('deps').email,
      platform,
      await c.get('deps').siteInvitations.getSiteName(),
      c.req.url,
      invitation.email,
      invitation.token,
      invitation.expiresAt,
    )
    return c.json(invitation)
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const orgId = c.get('orgId')!

    const id = c.req.param('id')
    const result = await c.get('deps').siteInvitations.revokeSiteInvitation(id, userId)
    if (result === 'not_found') return c.json({ error: 'Invitation not found' }, 404)
    if (result === 'already_accepted') return c.json({ error: 'Invitation has already been used' }, 400)
    if (result === 'already_revoked') return c.json({ error: 'Invitation has already been revoked' }, 400)
    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'site_invitation_revoke',
      targetType: 'site_invitation',
      targetId: id,
      targetName: id,
    })
    return c.json({ id, revoked: true })
  })

export const publicSiteInvitations = new Hono<Env>().get('/:token', async (c) => {
  const token = c.req.param('token')
  const invitation = await c.get('deps').siteInvitations.getSiteInvitationByToken(token)
  if (!invitation) return c.json({ error: 'Invitation not found' }, 404)
  return c.json(invitation)
})
