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

export interface InviteRepo {
  generate(adminUserId: string, quantity: number, expiresAt?: Date): Promise<InviteCodeRecord[]>
  validate(code: string): Promise<{ valid: boolean; error?: string }>
  redeem(code: string, userId: string): Promise<'ok' | 'not_found' | 'already_used' | 'expired'>
  list(opts: KeysetPageOpts): Promise<KeysetPage<InviteCodeRecord>>
  delete(codeId: string): Promise<'ok' | 'not_found' | 'already_used'>
}
