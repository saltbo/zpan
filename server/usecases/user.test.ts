import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform/interface'
import type {
  EntitlementResult,
  ImageUpload,
  ImageUploadResult,
  ProfileRepo,
  PublicUser,
  QuotaEntitlementItem,
  UserAdminRepo,
  UserOperationFailure,
} from './ports'
import {
  type AvatarDeps,
  getPublicProfile,
  grantUserEntitlement,
  listUserEntitlements,
  removeAvatar,
  revokeUserEntitlement,
  type UserDeps,
  updateAvatar,
  updateUserEntitlement,
} from './user'

const sampleEntitlement = {
  id: 'ent-1',
  orgId: 'org-1',
  resourceType: 'storage',
  bytes: 1000,
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
} as QuotaEntitlementItem

const sampleResult: EntitlementResult = { orgId: 'org-1', entitlement: sampleEntitlement }

const failure: UserOperationFailure = { error: 'User not found: missing', status: 404 }

// Every UserAdminRepo method is stubbed so a usecase can override just the one it
// exercises; the activity recorder is a spy each test asserts was/was not called.
function makeDeps(userAdmin: Partial<UserAdminRepo> = {}) {
  const record = vi.fn(async () => {})
  const repo: UserAdminRepo = {
    isBanned: async () => false,
    matchesUsername: async () => false,
    listUserPersonalEntitlements: async () => ({ orgId: 'org-1', items: [] }),
    grantUserPersonalEntitlement: async () => sampleResult,
    updateUserPersonalEntitlement: async () => sampleResult,
    revokeUserPersonalEntitlement: async () => sampleResult,
    requireOrg: async () => ({ orgId: 'org-1' }),
    listOrgEntitlements: async () => ({ orgId: 'org-1', items: [] }),
    grantOrgEntitlement: async () => sampleResult,
    updateOrgEntitlement: async () => sampleResult,
    revokeOrgEntitlement: async () => sampleResult,
    ...userAdmin,
  }
  const deps: UserDeps = { userAdmin: repo, activity: { record } as unknown as UserDeps['activity'] }
  return { deps, record }
}

beforeEach(() => vi.clearAllMocks())

describe('user usecase', () => {
  describe('listUserEntitlements', () => {
    it('returns the repo result', async () => {
      const result = { orgId: 'org-1', items: [sampleEntitlement] }
      const { deps } = makeDeps({ listUserPersonalEntitlements: async () => result })
      expect(await listUserEntitlements(deps, 'u-1')).toEqual({ ok: true, result })
    })

    it('threads the repo failure outward', async () => {
      const { deps } = makeDeps({ listUserPersonalEntitlements: async () => failure })
      expect(await listUserEntitlements(deps, 'x')).toEqual({ ok: false, failure })
    })
  })

  describe('grantUserEntitlement', () => {
    it('grants, forwards input, and records activity', async () => {
      const grant = vi.fn(async () => sampleResult)
      const { deps, record } = makeDeps({ grantUserPersonalEntitlement: grant })
      const expiresAt = new Date('2030-01-01T00:00:00.000Z')
      const out = await grantUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'u-1',
        resourceType: 'storage',
        bytes: 1000,
        expiresAt,
        note: 'bonus',
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(grant).toHaveBeenCalledWith({
        adminUserId: 'admin',
        targetUserId: 'u-1',
        resourceType: 'storage',
        bytes: 1000,
        expiresAt,
        note: 'bonus',
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'quota_entitlement_grant',
          targetType: 'quota',
          targetId: 'org-1',
          targetName: 'u-1',
          metadata: {
            targetUserId: 'u-1',
            entitlementId: 'ent-1',
            resourceType: 'storage',
            bytes: 1000,
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        }),
      )
    })

    it('records null expiresAt when the entitlement has none', async () => {
      const result = { orgId: 'org-1', entitlement: { ...sampleEntitlement, expiresAt: null } } as EntitlementResult
      const { deps, record } = makeDeps({ grantUserPersonalEntitlement: async () => result })
      await grantUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'u-1',
        resourceType: 'storage',
        bytes: 1000,
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ expiresAt: null }) }),
      )
    })

    it('threads the repo failure outward without recording', async () => {
      const { deps, record } = makeDeps({ grantUserPersonalEntitlement: async () => failure })
      const out = await grantUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'x',
        resourceType: 'storage',
        bytes: 1000,
      })
      expect(out).toEqual({ ok: false, failure })
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('updateUserEntitlement', () => {
    it('updates, forwards input, and records activity', async () => {
      const update = vi.fn(async () => sampleResult)
      const { deps, record } = makeDeps({ updateUserPersonalEntitlement: update })
      const out = await updateUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'u-1',
        entitlementId: 'ent-1',
        bytes: 5000,
        expiresAt: undefined,
        note: 'bumped',
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(update).toHaveBeenCalledWith({
        adminUserId: 'admin',
        targetUserId: 'u-1',
        entitlementId: 'ent-1',
        bytes: 5000,
        expiresAt: undefined,
        note: 'bumped',
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'quota_entitlement_update',
          targetType: 'quota',
          targetId: 'org-1',
          targetName: 'u-1',
          metadata: {
            targetUserId: 'u-1',
            entitlementId: 'ent-1',
            bytes: 1000,
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        }),
      )
    })

    it('threads the repo failure outward without recording', async () => {
      const { deps, record } = makeDeps({ updateUserPersonalEntitlement: async () => failure })
      const out = await updateUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'x',
        entitlementId: 'ent-x',
      })
      expect(out).toEqual({ ok: false, failure })
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('revokeUserEntitlement', () => {
    it('revokes, forwards input, and records activity', async () => {
      const revoke = vi.fn(async () => sampleResult)
      const { deps, record } = makeDeps({ revokeUserPersonalEntitlement: revoke })
      const out = await revokeUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'u-1',
        entitlementId: 'ent-1',
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(revoke).toHaveBeenCalledWith({ adminUserId: 'admin', targetUserId: 'u-1', entitlementId: 'ent-1' })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'quota_entitlement_revoke',
          targetType: 'quota',
          targetId: 'org-1',
          targetName: 'u-1',
          metadata: { targetUserId: 'u-1', entitlementId: 'ent-1', bytes: 1000 },
        }),
      )
    })

    it('threads the repo failure outward without recording', async () => {
      const { deps, record } = makeDeps({ revokeUserPersonalEntitlement: async () => failure })
      const out = await revokeUserEntitlement(deps, {
        adminUserId: 'admin',
        adminOrgId: 'o1',
        targetUserId: 'x',
        entitlementId: 'ent-x',
      })
      expect(out).toEqual({ ok: false, failure })
      expect(record).not.toHaveBeenCalled()
    })
  })
})

describe('avatar (self)', () => {
  const AVATAR_PREFIX = '_system/avatars'
  // platform is an opaque request-bound capability here — the usecase only
  // forwards it to the gateway, so a sentinel is enough to assert pass-through.
  const platform = { tag: 'platform' } as unknown as Platform
  const sampleFile = new File([new Uint8Array(8)], 'a.png', { type: 'image/png' })

  function makeAvatarDeps(image: Partial<ImageUpload> = {}) {
    const setAvatar = vi.fn(async () => {})
    const uploadPublicImage = vi.fn(async (): Promise<ImageUploadResult> => ({ ok: true, url: 'https://cdn/a.png' }))
    const deletePublicImageVariants = vi.fn(async () => {})
    const deps: AvatarDeps = {
      imageUpload: { uploadPublicImage, deletePublicImageVariants, ...image } as ImageUpload,
      profiles: { setAvatar } as unknown as ProfileRepo,
    }
    return { deps, setAvatar, uploadPublicImage, deletePublicImageVariants }
  }

  beforeEach(() => vi.clearAllMocks())

  describe('updateAvatar', () => {
    it('uploads, persists the url via setAvatar, and returns it', async () => {
      const uploadPublicImage = vi.fn(
        async (): Promise<ImageUploadResult> => ({ ok: true, url: 'https://cdn/_system/avatars/u1.png' }),
      )
      const { deps, setAvatar } = makeAvatarDeps({ uploadPublicImage })

      const out = await updateAvatar(deps, { platform, userId: 'u1', file: sampleFile })

      expect(out).toEqual({ ok: true, url: 'https://cdn/_system/avatars/u1.png' })
      expect(uploadPublicImage).toHaveBeenCalledWith(platform, AVATAR_PREFIX, 'u1', sampleFile)
      expect(setAvatar).toHaveBeenCalledWith('u1', 'https://cdn/_system/avatars/u1.png')
    })

    // The gateway owns which status a rejection carries (400 bad mime, 413 too
    // large, 503 no public storage); the usecase surfaces it verbatim.
    it.each([
      { ok: false, status: 400, error: 'unsupported mime' },
      { ok: false, status: 413, error: 'too large' },
      { ok: false, status: 503, error: 'no public storage' },
    ] satisfies ImageUploadResult[])('surfaces gateway failure ($status) and does not persist', async (failure) => {
      const uploadPublicImage = vi.fn(async (): Promise<ImageUploadResult> => failure)
      const { deps, setAvatar } = makeAvatarDeps({ uploadPublicImage })

      const out = await updateAvatar(deps, { platform, userId: 'u1', file: sampleFile })

      expect(out).toEqual(failure)
      expect(setAvatar).not.toHaveBeenCalled()
    })
  })

  describe('removeAvatar', () => {
    it('clears the avatar in DB first, then best-effort removes storage variants', async () => {
      const calls: string[] = []
      const setAvatar = vi.fn(async () => {
        calls.push('setAvatar')
      })
      const deletePublicImageVariants = vi.fn(async () => {
        calls.push('deleteVariants')
      })
      const { deps } = makeAvatarDeps({ deletePublicImageVariants })
      deps.profiles = { setAvatar } as unknown as ProfileRepo

      await removeAvatar(deps, { platform, userId: 'u1' })

      expect(setAvatar).toHaveBeenCalledWith('u1', null)
      expect(deletePublicImageVariants).toHaveBeenCalledWith(platform, AVATAR_PREFIX, 'u1')
      expect(calls).toEqual(['setAvatar', 'deleteVariants'])
    })
  })
})

describe('public profile', () => {
  const samplePublicUser: PublicUser = { username: 'bob', name: 'Bob', image: null }
  const withUser = (user: PublicUser | null) => ({
    profiles: { getUserByUsername: async () => user, setAvatar: async () => {} } as ProfileRepo,
  })

  it('returns the public user', async () => {
    expect(await getPublicProfile(withUser(samplePublicUser), 'bob')).toEqual(samplePublicUser)
  })

  it('returns null when the user does not exist', async () => {
    expect(await getPublicProfile(withUser(null), 'ghost')).toBeNull()
  })

  it('queries by the given username', async () => {
    const getUserByUsername = vi.fn(async () => samplePublicUser)
    await getPublicProfile({ profiles: { getUserByUsername, setAvatar: async () => {} } as ProfileRepo }, 'alice')
    expect(getUserByUsername).toHaveBeenCalledWith('alice')
  })
})
