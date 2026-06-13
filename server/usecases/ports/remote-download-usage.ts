export type RemoteDownloadUsageStatus = 'pending' | 'reported' | 'skipped_unbound' | 'blocked' | 'failed'

export interface RemoteDownloadUsageReportRecord {
  id: string
  orgId: string
  downloaderId: string
  taskId: string
  eventId: string
  unitIndex: number
  unitBytes: number
  creditsPerUnit: number
  status: RemoteDownloadUsageStatus
  error: string | null
  createdAt: Date
  updatedAt: Date
}

export interface InsertRemoteDownloadUsageReportInput {
  orgId: string
  downloaderId: string
  taskId: string
  eventId: string
  unitIndex: number
  unitBytes: number
  creditsPerUnit: number
  now: Date
}

export interface RemoteDownloadUsageRepo {
  findByEventId(eventId: string): Promise<RemoteDownloadUsageReportRecord | undefined>
  insert(input: InsertRemoteDownloadUsageReportInput): Promise<void>
  updateStatus(eventId: string, status: RemoteDownloadUsageStatus, error: string | null, now: Date): Promise<void>
  listPending(limit: number): Promise<RemoteDownloadUsageReportRecord[]>
}
