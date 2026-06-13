import type { SiteInvitation } from '@shared/types'

export type ResendSiteInvitationResult = SiteInvitation | 'not_found' | 'already_accepted' | 'already_revoked'

export type RevokeSiteInvitationResult = 'ok' | 'not_found' | 'already_accepted' | 'already_revoked'

export type AcceptSiteInvitationResult = 'ok' | 'not_found' | 'revoked' | 'accepted' | 'expired' | 'email_mismatch'

export interface SiteInvitationRepo {
  getSiteName(): Promise<string>
  listSiteInvitations(page: number, pageSize: number): Promise<{ items: SiteInvitation[]; total: number }>
  createSiteInvitation(adminUserId: string, rawEmail: string): Promise<SiteInvitation>
  resendSiteInvitation(invitationId: string): Promise<ResendSiteInvitationResult>
  revokeSiteInvitation(invitationId: string, adminUserId: string): Promise<RevokeSiteInvitationResult>
  getSiteInvitationByToken(token: string): Promise<SiteInvitation | null>
  validateSiteInvitation(token: string, rawEmail: string): Promise<{ valid: boolean; error?: string }>
  acceptSiteInvitation(token: string, rawEmail: string, userId: string): Promise<AcceptSiteInvitationResult>
}
