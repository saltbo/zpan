// The site-invitations resource usecase. Owns every business decision behind the
// /api/site/invitations routes — duplicate
// detection on create, the resend/revoke state machine, the invite email (link
// construction + HTML body), and activity logging — so the http handlers only
// validate input, call these functions, and serialize the result.

import type { SiteInvitation } from '@shared/types'
import type { Platform } from '../../platform/interface'
import {
  AppError,
  badRequest,
  conflict,
  type EmailGateway,
  externalError,
  type KeysetPage,
  type KeysetPageOpts,
  notFound,
  type SiteInvitationRepo,
} from '../ports'

export type SiteInvitationDeps = {
  siteInvitations: SiteInvitationRepo
  email: EmailGateway
}

// createSiteInvitation returns a 409 carrying the repo's message on a duplicate
// pending invite. Both create and resend return emailNotConfigured() when email
// delivery is disabled or unconfigured, before any invitation row changes.
export type CreateSiteInvitationOutcome = { ok: true; invitation: SiteInvitation } | { ok: false; error: AppError }

export type ResendSiteInvitationOutcome = { ok: true; invitation: SiteInvitation } | { ok: false; error: AppError }

export type RevokeSiteInvitationOutcome = { ok: true; id: string } | { ok: false; error: AppError }

function buildSignupInviteEmailHtml(data: { siteName: string; inviteLink: string; expiresAt: string }) {
  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">You're invited to register on ${data.siteName}</h2>
<p style="color:#555;line-height:1.5">The administrator invited you to create an account on <strong>${data.siteName}</strong>.</p>
<a href="${data.inviteLink}" style="display:inline-block;margin:24px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Create Account</a>
<p style="color:#999;font-size:13px">This invitation expires on ${new Date(data.expiresAt).toLocaleDateString()}.</p>
</div>`
}

// An invitation is useless unless its email can be sent, so the admin is told to
// configure email first instead of getting an internal error.
function emailNotConfigured(): AppError {
  return new AppError(400, 'Configure email delivery before sending invitations', {
    reason: 'EMAIL_NOT_CONFIGURED',
    canonicalStatus: 'FAILED_PRECONDITION',
  })
}

// Builds the /sign-up?invite=<token> link off the request URL and sends the
// invite. requestUrl is the inbound request URL — the invite link is rooted at
// the same origin.
async function sendSiteInvitationEmail(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'email'>,
  platform: Platform,
  requestUrl: string,
  invitation: SiteInvitation,
): Promise<void> {
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
  opts: KeysetPageOpts,
): Promise<KeysetPage<SiteInvitation>> {
  return deps.siteInvitations.listSiteInvitations(opts)
}

export async function createSiteInvitation(
  deps: SiteInvitationDeps,
  platform: Platform,
  params: { userId: string; email: string; requestUrl: string },
): Promise<CreateSiteInvitationOutcome> {
  const { userId, email, requestUrl } = params
  // Check email before creating, so a missing mailer never leaves an invitation
  // row behind.
  if (!(await deps.email.isConfigured(platform))) return { ok: false, error: emailNotConfigured() }
  let invitation: SiteInvitation
  try {
    invitation = await deps.siteInvitations.createSiteInvitation(userId, email)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return { ok: false, error: externalError(conflict, text, 'Failed to create invitation') }
  }
  await sendSiteInvitationEmail(deps, platform, requestUrl, invitation)
  return { ok: true, invitation }
}

export async function resendSiteInvitation(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'email'>,
  platform: Platform,
  params: { id: string; requestUrl: string },
): Promise<ResendSiteInvitationOutcome> {
  if (!(await deps.email.isConfigured(platform))) return { ok: false, error: emailNotConfigured() }
  const invitation = await deps.siteInvitations.resendSiteInvitation(params.id)
  if (invitation === 'not_found') return { ok: false, error: notFound('Invitation not found') }
  if (invitation === 'already_accepted') return { ok: false, error: badRequest('Invitation has already been used') }
  if (invitation === 'already_revoked') return { ok: false, error: badRequest('Invitation has been revoked') }
  await sendSiteInvitationEmail(deps, platform, params.requestUrl, invitation)
  return { ok: true, invitation }
}

export async function revokeSiteInvitation(
  deps: Pick<SiteInvitationDeps, 'siteInvitations'>,
  params: { userId: string; id: string },
): Promise<RevokeSiteInvitationOutcome> {
  const { userId, id } = params
  const result = await deps.siteInvitations.revokeSiteInvitation(id, userId)
  if (result === 'not_found') return { ok: false, error: notFound('Invitation not found') }
  if (result === 'already_accepted') return { ok: false, error: badRequest('Invitation has already been used') }
  if (result === 'already_revoked') return { ok: false, error: badRequest('Invitation has already been revoked') }
  return { ok: true, id }
}

export function getSiteInvitationByToken(
  deps: Pick<SiteInvitationDeps, 'siteInvitations'>,
  token: string,
): Promise<SiteInvitation | null> {
  return deps.siteInvitations.getSiteInvitationByToken(token)
}
