import type { PublicUser } from '@shared/schemas/profile'

export type { PublicUser } from '@shared/schemas/profile'

export interface ProfileRepo {
  getUserByUsername(username: string): Promise<PublicUser | null>
  setAvatar(userId: string, image: string | null): Promise<void>
}
