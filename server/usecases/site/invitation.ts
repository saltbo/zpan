// The site-invitations resource usecase. Owns every business decision behind the
// /api/site/invitations routes — duplicate
// detection on create, the resend/revoke state machine, the invite email (link
// construction + HTML body), and activity logging — so the http handlers only
// validate input, call these functions, and serialize the result.

import type { SiteInvitation } from '@shared/types'
import type { Platform } from '../../platform/interface'
import {
  AppError,
  badGateway,
  badRequest,
  type CreateSiteInvitationResult,
  conflict,
  type EmailGateway,
  externalError,
  internalError,
  type KeysetPage,
  type KeysetPageOpts,
  notFound,
  type SiteInvitationRepo,
} from '../ports'

export type SiteInvitationDeps = {
  siteInvitations: SiteInvitationRepo
  email: EmailGateway
}

// createSiteInvitation returns a 409 when a user or a pending invitation already
// has the email, a 500 when the invitation cannot be saved, and a 502 when its
// email cannot be sent, after deleting the invitation so the admin can retry. Both create and resend return emailNotConfigured() when email
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
// the same origin. A failed send comes back as a 502 with a product message; the
// provider's own text goes only to the server log.
async function sendSiteInvitationEmail(
  deps: Pick<SiteInvitationDeps, 'siteInvitations' | 'email'>,
  platform: Platform,
  requestUrl: string,
  invitation: SiteInvitation,
): Promise<AppError | null> {
  const siteName = await deps.siteInvitations.getSiteName()
  const inviteLink = new URL('/sign-up', requestUrl)
  inviteLink.searchParams.set('invite', invitation.token)
  try {
    await deps.email.send(platform, {
      to: invitation.email,
      subject: `You're invited to register on ${siteName}`,
      html: buildSignupInviteEmailHtml({
        siteName,
        inviteLink: inviteLink.toString(),
        expiresAt: invitation.expiresAt,
      }),
    })
    return null
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return externalError(
      badGateway,
      text,
      'The invitation email could not be sent. Check the email settings and try again.',
    )
  }
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
  let invitation: CreateSiteInvitationResult
  try {
    invitation = await deps.siteInvitations.createSiteInvitation(userId, email)
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    return { ok: false, error: externalError(internalError, text, 'Failed to create invitation') }
  }
  if (invitation === 'user_exists') return { ok: false, error: conflict('A user with this email already exists') }
  if (invitation === 'pending_exists') {
    return { ok: false, error: conflict('A pending invitation already exists for this email') }
  }
  const sendError = await sendSiteInvitationEmail(deps, platform, requestUrl, invitation)
  if (sendError) {
    // The invitee never got the link, so keeping the row would only make the
    // admin's retry answer 409 for an invitation nobody received.
    await deps.siteInvitations.deleteSiteInvitation(invitation.id)
    return { ok: false, error: sendError }
  }
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
  const sendError = await sendSiteInvitationEmail(deps, platform, params.requestUrl, invitation)
  if (sendError) return { ok: false, error: sendError }
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
