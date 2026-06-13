// The Deps interface aggregates every port. Usecases take `deps` as their first
// argument and reach the outside world only through it; http routes read it from
// context (`c.get('deps')`). It is assembled in composition.ts.

import type {
  ActivityRepo,
  AnnouncementRepo,
  InviteRepo,
  NotificationRepo,
  OrgRepo,
  ProfileRepo,
  StorageRepo,
} from './ports'

export interface Deps {
  activity: ActivityRepo
  announcements: AnnouncementRepo
  invites: InviteRepo
  notifications: NotificationRepo
  org: OrgRepo
  profiles: ProfileRepo
  storages: StorageRepo
}
