import { describe, expect, it, vi } from 'vitest'
import type { ProfileRepo, PublicUser } from './ports'
import { getPublicProfile } from './profile'

const sampleUser: PublicUser = { username: 'bob', name: 'Bob', image: null }
const withUser = (user: PublicUser | null) => ({
  profiles: { getUserByUsername: async () => user, setAvatar: async () => {} } as ProfileRepo,
})

describe('profile usecase', () => {
  it('returns the public user', async () => {
    expect(await getPublicProfile(withUser(sampleUser), 'bob')).toEqual(sampleUser)
  })

  it('returns null when the user does not exist', async () => {
    expect(await getPublicProfile(withUser(null), 'ghost')).toBeNull()
  })

  it('queries by the given username', async () => {
    const getUserByUsername = vi.fn(async () => sampleUser)
    await getPublicProfile({ profiles: { getUserByUsername, setAvatar: async () => {} } as ProfileRepo }, 'alice')
    expect(getUserByUsername).toHaveBeenCalledWith('alice')
  })
})
