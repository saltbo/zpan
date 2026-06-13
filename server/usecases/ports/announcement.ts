import type { AnnouncementInput, AnnouncementStatus } from '@shared/schemas'

export interface AnnouncementRecord {
  id: string
  title: string
  body: string
  status: AnnouncementStatus
  priority: number
  publishedAt: Date | null
  expiresAt: Date | null
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface ListAnnouncementsResult {
  items: AnnouncementRecord[]
  total: number
  page: number
  pageSize: number
}

export interface AnnouncementRepo {
  create(input: AnnouncementInput, createdBy: string): Promise<AnnouncementRecord>
  listAdmin(opts: { status?: AnnouncementStatus; page: number; pageSize: number }): Promise<ListAnnouncementsResult>
  get(id: string): Promise<AnnouncementRecord | null>
  update(id: string, input: AnnouncementInput): Promise<AnnouncementRecord | null>
  delete(id: string): Promise<boolean>
  listUser(opts: { activeOnly: boolean; page: number; pageSize: number }): Promise<ListAnnouncementsResult>
}
