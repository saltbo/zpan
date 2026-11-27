import type { KeysetPage, KeysetPageOpts } from './pagination'

export interface InviteCodeRecord {
  id: string
  code: string
  createdBy: string
  usedBy: string | null
  usedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

export interface InviteCodeRedeemer {
  name: string
  email: string
}

// A listed code with the user who redeemed it; `usedByUser` is absent when the
// code is unused or that user no longer exists.
export interface InviteCodeListItem extends InviteCodeRecord {
  usedByUser?: InviteCodeRedeemer
}

export interface InviteRepo {
  generate(adminUserId: string, quantity: number, expiresAt?: Date): Promise<InviteCodeRecord[]>
  validate(code: string): Promise<{ valid: boolean; error?: string }>
  redeem(code: string, userId: string): Promise<'ok' | 'not_found' | 'already_used' | 'expired'>
  list(opts: KeysetPageOpts): Promise<KeysetPage<InviteCodeListItem>>
  delete(codeId: string): Promise<'ok' | 'not_found' | 'already_used'>
}
