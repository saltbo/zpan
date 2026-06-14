// The public profile resource usecase (/api/profiles/:username). Self-scoped
// avatar mutations live in the `me` resource (usecases/me.ts); this file is the
// read-only public lookup.

import type { ProfileRepo, PublicUser } from './ports'

export function getPublicProfile(deps: { profiles: ProfileRepo }, username: string): Promise<PublicUser | null> {
  return deps.profiles.getUserByUsername(username)
}
