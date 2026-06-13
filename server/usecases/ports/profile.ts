export interface PublicUser {
  username: string
  name: string
  image: string | null
}

export interface ProfileRepo {
  getUserByUsername(username: string): Promise<PublicUser | null>
  setAvatar(userId: string, image: string | null): Promise<void>
}
