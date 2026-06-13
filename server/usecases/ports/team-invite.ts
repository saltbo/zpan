export interface TeamInviteLinkRecord {
  id: string
  token: string
  organizationId: string
  role: string
  inviterId: string
  expiresAt: Date
  createdAt: Date
}

export interface InviteLinkInfo {
  organizationId: string
  organizationName: string
  role: string
  expiresAt: Date | null
}

export type AcceptInviteResult = 'ok' | 'invalid' | 'expired' | 'already_member'

export interface PendingInvitation {
  id: string
  email: string
  role: string
  expiresAt: Date | null
  createdAt: Date
}

export interface TeamInviteRepo {
  createInviteLink(
    organizationId: string,
    inviterId: string,
    role: string,
    expiresIn?: number,
  ): Promise<TeamInviteLinkRecord>
  getInviteLinkInfo(token: string): Promise<InviteLinkInfo | null>
  acceptInviteLink(token: string, userId: string): Promise<AcceptInviteResult>
  listPendingInvitations(organizationId: string): Promise<PendingInvitation[]>
}
