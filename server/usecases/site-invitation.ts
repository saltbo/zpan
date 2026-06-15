// The site-invitations resource usecase. Owns every business decision behind the
// /api/invitations routes — duplicate
// detection on create, the resend/revoke state machine, the invite email (link
// construction + HTML body), and activity logging — so the http handlers only
// validate input, call these functions, and serialize the result.

import type { SiteInvitation } from '@shared/types'
import type { Platform } from '../platform/interface'
import type { ActivityRepo, EmailGateway, SiteInvitationRepo } from './ports'

export type SiteInvitationDeps = {
  siteInvitations: SiteInvitationRepo
  email: EmailGateway
  activity: ActivityRepo
}

// createSiteInvitation throws on a duplicate pending invite; the handler turns a
// thrown error into a 409. Surface the message so it round-trips into the body.
export type CreateSiteInvitationOutcome =
  | { ok: true; invitation: SiteInvitation }
  | { ok: false; reason: 'conflict'; message: string }

// Maps to 404 (not_found) and 400 (already_accepted / already_revoked).
export type ResendSiteInvitationOutcome =
  | { ok: true; invitation: SiteInvitation }
  | { ok: false; reason: 'not_found' | 'already_accepted' | 'already_revoked' }

// Maps to 404 (not_found) and 400 (already_accepted / already_revoked).
export type RevokeSiteInvitationOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'already_accepted' | 'already_revoked' }

function buildSignupInviteEmailHtml(data: { siteName: string; inviteLink: string; expiresAt: string }) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">You're invited to register on ${data.siteName}</h2>
<p style="color:#555;line-height:1.5">The administrator invited you to create an account on <strong>${data.siteName}</strong>.</p>
<a href="${data.inviteLink}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Create Account</a>
<p style="color:#999;font-size:13px">This invitation expires on ${new Date(data.expiresAt).toLocaleDateString()}.</p>
</div>`
}

// Reads email config (which throws when email is not configured, the same guard
// the create/resend flows rely on), builds the /sign-up?invite=<token> link off
// the request URL, and sends the invite. requestUrl is the inbound request URL —
// the invite link is rooted at the same origin.
async function sendSiteInvitationEmail(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'email'>,
  platform: Platform,
  requestUrl: string,
  invitation: SiteInvitation,
): Promise<void> {
  await deps.email.getConfig(platform)
  const siteName = await deps.siteInvitations.getSiteName()
  const inviteLink = new URL('/sign-up', requestUrl)
  inviteLink.searchParams.set('invite', invitation.token)
  await deps.email.send(platform, {
    to: invitation.email,
    subject: `You're invited to register on ${siteName}`,
    html: buildSignupInviteEmailHtml({
      siteName,
      inviteLink: inviteLink.toString(),
      expiresAt: invitation.expiresAt,
    }),
  })
}

export function listSiteInvitations(
  deps: Pick<SiteInvitationDeps, 'siteInvitations'>,
  page: number,
  pageSize: number,
): Promise<{ items: SiteInvitation[]; total: number }> {
  return deps.siteInvitations.listSiteInvitations(page, pageSize)
}

export async function createSiteInvitation(
  deps: SiteInvitationDeps,
  platform: Platform,
  params: { userId: string; orgId: string; email: string; requestUrl: string },
): Promise<CreateSiteInvitationOutcome> {
  const { userId, orgId, email, requestUrl } = params
  // Validate email config before creating — mirrors the handler ordering so a
  // misconfigured mailer surfaces before an invitation row is written.
  await deps.email.getConfig(platform)
  let invitation: SiteInvitation
  try {
    invitation = await deps.siteInvitations.createSiteInvitation(userId, email)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create invitation'
    return { ok: false, reason: 'conflict', message }
  }
  await sendSiteInvitationEmail(deps, platform, requestUrl, invitation)
  await deps.activity.record({
    orgId,
    userId,
    action: 'site_invitation_create',
    targetType: 'site_invitation',
    targetId: invitation.id,
    targetName: invitation.email,
  })
  return { ok: true, invitation }
}

export async function resendSiteInvitation(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'email'>,
  platform: Platform,
  params: { id: string; requestUrl: string },
): Promise<ResendSiteInvitationOutcome> {
  const invitation = await deps.siteInvitations.resendSiteInvitation(params.id)
  if (invitation === 'not_found') return { ok: false, reason: 'not_found' }
  if (invitation === 'already_accepted') return { ok: false, reason: 'already_accepted' }
  if (invitation === 'already_revoked') return { ok: false, reason: 'already_revoked' }
  await sendSiteInvitationEmail(deps, platform, params.requestUrl, invitation)
  return { ok: true, invitation }
}

export async function revokeSiteInvitation(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'activity'>,
  params: { userId: string; orgId: string; id: string },
): Promise<RevokeSiteInvitationOutcome> {
  const { userId, orgId, id } = params
  const result = await deps.siteInvitations.revokeSiteInvitation(id, userId)
  if (result === 'not_found') return { ok: false, reason: 'not_found' }
  if (result === 'already_accepted') return { ok: false, reason: 'already_accepted' }
  if (result === 'already_revoked') return { ok: false, reason: 'already_revoked' }
  await deps.activity.record({
    orgId,
    userId,
    action: 'site_invitation_revoke',
    targetType: 'site_invitation',
    targetId: id,
    targetName: id,
  })
  return { ok: true, id }
}

export function getSiteInvitationByToken(
  deps: Pick<SiteInvitationDeps, 'siteInvitations'>,
  token: string,
): Promise<SiteInvitation | null> {
  return deps.siteInvitations.getSiteInvitationByToken(token)
}
