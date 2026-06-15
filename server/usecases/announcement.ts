// The announcements resource usecase (/api/announcements, /api/admin/announcements).
// All routes are single-port operations; they go through here so the resource
// has one home and handlers stay free of deps access.

import type { AnnouncementInput, AnnouncementStatus } from '@shared/schemas'
import type { AnnouncementRecord, AnnouncementRepo, ListAnnouncementsResult } from './ports'

type AnnouncementDeps = { announcements: AnnouncementRepo }

export function listUserAnnouncements(
  deps: AnnouncementDeps,
  opts: { activeOnly: boolean; page: number; pageSize: number },
): Promise<ListAnnouncementsResult> {
  return deps.announcements.listUser(opts)
}

export function listAdminAnnouncements(
  deps: AnnouncementDeps,
  opts: { status?: AnnouncementStatus; page: number; pageSize: number },
): Promise<ListAnnouncementsResult> {
  return deps.announcements.listAdmin(opts)
}

export function createAnnouncement(
  deps: AnnouncementDeps,
  input: AnnouncementInput,
  createdBy: string,
): Promise<AnnouncementRecord> {
  return deps.announcements.create(input, createdBy)
}

export function getAnnouncement(deps: AnnouncementDeps, id: string): Promise<AnnouncementRecord | null> {
  return deps.announcements.get(id)
}

export function updateAnnouncement(
  deps: AnnouncementDeps,
  id: string,
  input: AnnouncementInput,
): Promise<AnnouncementRecord | null> {
  return deps.announcements.update(id, input)
}

export function deleteAnnouncement(deps: AnnouncementDeps, id: string): Promise<boolean> {
  return deps.announcements.delete(id)
}
