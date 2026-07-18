import type { CreateShareInput } from '@shared/schemas/share'
import type { RecordActivityInput } from './activity'
import type { Matter } from './matter'

// ─── DTOs ──────────────────────────────────────────────────────────────────
// Plain records mirroring the shares / share_recipients tables. Timestamps stay
// Date (the http layer serializes them). Drizzle row types never cross this port.

export interface ShareRecord {
  id: string
  token: string
  kind: string
  matterId: string
  orgId: string
  creatorId: string
  passwordHash: string | null
  expiresAt: Date | null
  downloadLimit: number | null
  views: number
  downloads: number
  status: string
  createdAt: Date
}

export interface ShareRecipientRecord {
  id: string
  shareId: string
  recipientUserId: string | null
  recipientEmail: string | null
  createdAt: Date
}

export interface ShareListItem {
  id: string
  token: string
  kind: string
  matterId: string
  orgId: string
  creatorId: string
  expiresAt: Date | null
  downloadLimit: number | null
  views: number
  downloads: number
  status: string
  createdAt: Date
  matter: { name: string; type: string; dirtype: number }
  recipientCount: number
  creatorName?: string
}

export type ShareResolution =
  | { status: 'ok'; share: ShareRecord; matter: Matter; recipients: ShareRecipientRecord[] }
  // matter_trashed carries the records so the creator-only revoke path can still
  // act on the share; viewer-facing callers branch on `status` and ignore them.
  | { status: 'matter_trashed'; share: ShareRecord; matter: Matter; recipients: ShareRecipientRecord[] }
  | { status: 'not_found' }
  | { status: 'revoked' }

// Thrown by createShare on invalid share-shape combinations. Carries a stable
// code the http layer maps to a 400/404.
export class CreateShareError extends Error {
  constructor(public code: 'MATTER_NOT_FOUND' | 'DIRECT_NO_FOLDER' | 'DIRECT_NO_PASSWORD' | 'DIRECT_NO_RECIPIENTS') {
    super(code)
  }
}

export interface ShareRepo {
  create(input: CreateShareInput): Promise<ShareRecord>
  resolveByToken(token: string): Promise<ShareResolution>
  recordView(shareId: string, activity: RecordActivityInput): Promise<void>
  hasDownloadsAvailable(shareId: string): Promise<boolean>
  incrementDownloadsAtomic(shareId: string): Promise<{ ok: boolean; downloads: number }>
  decrementDownloads(shareId: string): Promise<void>
  listRecipientUserIds(shareId: string): Promise<string[]>
  cascadeDeleteByMatter(matterId: string): Promise<void>
  revokeByToken(token: string, creatorId: string): Promise<boolean>
  listForApi(
    creatorId: string,
    opts: { page: number; pageSize: number; status?: string },
  ): Promise<{ items: ShareListItem[]; total: number }>
  listReceivedForApi(
    userId: string,
    userEmail: string | null,
    opts: { page: number; pageSize: number },
  ): Promise<{ items: ShareListItem[]; total: number }>
  // Matter reads supporting the save-to-drive flow. They read the matters table
  // and are co-located in the share repo while matter remains unmigrated.
  computeSourceBytes(matter: Matter): Promise<number>
  listDirectActiveChildren(orgId: string, folderPath: string): Promise<Matter[]>
  hasQuotaForBytes(orgId: string, bytes: number): Promise<boolean>
  // Lookups the share routes need; co-located here while user/matter are
  // unmigrated so the share http layer holds no drizzle.
  getCreatorName(creatorId: string): Promise<string | null>
  getUserEmail(userId: string): Promise<string | null>
  getMatterName(matterId: string): Promise<string | null>
  findShareChildMatter(
    rootMatter: { id: string; orgId: string; parent: string; name: string },
    childId: string,
  ): Promise<Matter | null>
}
