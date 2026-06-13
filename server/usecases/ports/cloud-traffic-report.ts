export type TrafficReportSource =
  | 'object_download'
  | 'direct_share'
  | 'landing_share'
  | 'image_hosting'
  | 'custom_domain_image'
  | 'webdav_download'

export type CloudTrafficReportStatus = 'pending' | 'reported' | 'skipped_unbound' | 'blocked' | 'failed'

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
  storageId: string
  unitBytes: number
  creditsPerUnit: number
  status: CloudTrafficReportStatus
  now: Date
}

export interface CloudTrafficReportRepo {
  findByEventId(eventId: string): Promise<CloudTrafficReportRecord | undefined>
  insert(input: InsertCloudTrafficReportInput): Promise<void>
  updateStatus(eventId: string, status: CloudTrafficReportStatus, error: string | null, now: Date): Promise<void>
  listPending(limit: number): Promise<CloudTrafficReportRecord[]>
}
