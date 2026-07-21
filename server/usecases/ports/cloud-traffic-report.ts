export type TrafficReportSource =
  | 'object_download'
  | 'direct_share'
  | 'landing_share'
  | 'image_hosting'
  | 'custom_domain_image'
  | 'webdav_download'

export type CloudTrafficReportStatus =
  | 'pending'
  | 'reported'
  | 'not_required'
  | 'skipped_unbound'
  | 'blocked'
  | 'failed'
  | 'dead_letter'
  | 'reversed'
  | 'ledger_opening'

export interface CloudTrafficReportRecord {
  id: string
  orgId: string
  period: string
  source: string
  sourceId: string
  eventId: string
  bytes: number
  storageId: string | null
  unitBytes: number | null
  creditsPerUnit: number | null
  status: CloudTrafficReportStatus
  error: string | null
  attemptCount: number
  nextRetryAt: Date | null
  issuedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertCloudTrafficReportInput {
  orgId: string
  period: string
  source: TrafficReportSource
  sourceId: string
  eventId: string
  bytes: number
  storageId: string | null
  unitBytes: number | null
  creditsPerUnit: number | null
  status: CloudTrafficReportStatus
  now: Date
}

export interface CloudTrafficReportRepo {
  ensureLedgerOpening(now: Date): Promise<void>
  getLedgerOpening(): Promise<Date | null>
  findByEventId(eventId: string): Promise<CloudTrafficReportRecord | undefined>
  insert(input: InsertCloudTrafficReportInput): Promise<void>
  markIssued(eventId: string, now: Date): Promise<void>
  reverse(eventId: string, now: Date): Promise<void>
  updateStatus(
    eventId: string,
    status: CloudTrafficReportStatus,
    error: string | null,
    now: Date,
    retry?: { attemptCount: number; nextRetryAt: Date | null },
  ): Promise<void>
  listPending(limit: number, now: Date): Promise<CloudTrafficReportRecord[]>
}
