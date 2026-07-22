import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AuditRepo,
  EntitlementResult,
  ImageUpload,
  ImageUploadResult,
  InviteLinkInfo,
  OrgRepo,
  QuotaEntitlementItem,
  TeamInviteLinkRecord,
  TeamInviteRepo,
  TeamRepo,
  TeamSummary,
  UserAdminRepo,
  UserOperationFailure,
} from './ports'
import {
  createInviteLink,
  deleteTeamLogo,
  getInviteLinkInfo,
  getTeam,
  grantTeamEntitlement,
  joinTeam,
  listActivity,
  listInvitations,
  listTeamEntitlements,
  listTeams,
  revokeTeamEntitlement,
  setTeamLogo,
  type TeamDeps,
  updateTeamEntitlement,
} from './team'

const platform = {} as import('../platform/interface').Platform

const sampleTeam: TeamSummary = {
  id: 'team-1',
  name: 'Alpha',
  slug: 'alpha',
  logo: null,
  memberCount: 2,
  ownerName: 'Owner',
  quotaUsed: 0,
  quotaTotal: 1024,
  createdAt: 0,
}

const sampleEntitlement: QuotaEntitlementItem = {
  id: 'ent-1',
  orgId: 'team-1',
  resourceType: 'storage',
  entitlementType: 'admin_grant',
  source: 'admin',
  sourceId: 'admin:team-1',
  bytes: 1024,
  startsAt: new Date(0),
  expiresAt: null,
  status: 'active',
  metadata: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const sampleResult: EntitlementResult = { orgId: 'team-1', entitlement: sampleEntitlement }

const inviteLink: TeamInviteLinkRecord = {
  id: 'link-1',
  token: 'tok-1',
  organizationId: 'team-1',
  role: 'viewer',
  inviterId: 'u1',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  createdAt: new Date(0),
}

function makeDeps(
  overrides: {
    org?: Partial<OrgRepo>
    teamInvites?: Partial<TeamInviteRepo>
    teams?: Partial<TeamRepo>
    imageUpload?: Partial<ImageUpload>
    userAdmin?: Partial<UserAdminRepo>
  } = {},
) {
  const deps: TeamDeps = {
    audit: { record: async () => {}, list: async () => ({ items: [], total: 0 }) } as unknown as AuditRepo,
    org: {
      findPersonalOrg: async () => null,
      getMemberRole: async () => null,
      canReadOrg: async () => false,
      canWriteToOrg: async () => false,
      isPersonalOrg: async () => false,
      ...overrides.org,
    },
    teamInvites: {
      createInviteLink: async () => inviteLink,
      getInviteLinkInfo: async () => null,
      acceptInviteLink: async () => 'ok',
      listPendingInvitations: async () => [],
      ...overrides.teamInvites,
    },
    teams: {
      listTeams: async () => [],
      getTeam: async () => null,
      setLogo: async () => {},
      ...overrides.teams,
    },
    imageUpload: {
      uploadPublicImage: async () => ({ ok: true, url: 'https://cdn/logo.png' }) as ImageUploadResult,
      deletePublicImageVariants: async () => {},
      ...overrides.imageUpload,
    },
    userAdmin: {
      listOrgEntitlements: async () => ({ orgId: 'team-1', items: [] }),
      grantOrgEntitlement: async () => sampleResult,
      updateOrgEntitlement: async () => sampleResult,
      revokeOrgEntitlement: async () => sampleResult,
      ...overrides.userAdmin,
    } as unknown as UserAdminRepo,
  }
  return { deps }
}

beforeEach(() => vi.clearAllMocks())

describe('team usecase', () => {
  // ─── invite links ──────────────────────────────────────────────────────────
  describe('getInviteLinkInfo', () => {
    it('forwards the repo result', async () => {
      const info: InviteLinkInfo = {
        organizationId: 'team-1',
        organizationName: 'Alpha',
        role: 'viewer',
        expiresAt: null,
      }
      const { deps } = makeDeps({ teamInvites: { getInviteLinkInfo: async () => info } })
      expect(await getInviteLinkInfo(deps, 'tok')).toBe(info)
    })

    it('returns null for an unknown token', async () => {
      const { deps } = makeDeps({ teamInvites: { getInviteLinkInfo: async () => null } })
      expect(await getInviteLinkInfo(deps, 'nope')).toBeNull()
    })
  })

  describe('createInviteLink', () => {
    it('creates when caller is owner', async () => {
      const create = vi.fn(async () => inviteLink)
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'owner' },
        teamInvites: { createInviteLink: create },
      })
      const out = await createInviteLink(deps, { teamId: 'team-1', userId: 'u1', role: 'editor', expiresIn: 1000 })
      expect(out).toEqual({ ok: true, token: 'tok-1', expiresAt: inviteLink.expiresAt })
      expect(create).toHaveBeenCalledWith('team-1', 'u1', 'editor', 1000)
    })

    it('forbids a non-owner', async () => {
      const create = vi.fn(async () => inviteLink)
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'member' },
        teamInvites: { createInviteLink: create },
      })
      const out = await createInviteLink(deps, { teamId: 'team-1', userId: 'u1', role: 'viewer' })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('listInvitations', () => {
    it('returns pending invitations for an owner', async () => {
      const invitations = [{ id: 'i1', email: 'a@b.c', role: 'viewer', expiresAt: null, createdAt: new Date(0) }]
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'owner' },
        teamInvites: { listPendingInvitations: async () => invitations },
      })
      const out = await listInvitations(deps, { teamId: 'team-1', userId: 'u1' })
      expect(out).toEqual({ ok: true, invitations })
    })

    it('forbids a non-owner', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => 'viewer' } })
      expect(await listInvitations(deps, { teamId: 'team-1', userId: 'u1' })).toEqual({
        ok: false,
        reason: 'forbidden',
      })
    })
  })

  // ─── joining ───────────────────────────────────────────────────────────────
  describe('joinTeam', () => {
    it('joins on a valid token', async () => {
      const { deps } = makeDeps({ teamInvites: { acceptInviteLink: async () => 'ok' } })
      const out = await joinTeam(deps, { teamId: 'team-1', userId: 'u1', token: 'tok' })
      expect(out).toEqual({ ok: true })
    })

    it.each(['invalid', 'expired', 'already_member'] as const)('maps %s', async (reason) => {
      const { deps } = makeDeps({ teamInvites: { acceptInviteLink: async () => reason } })
      const out = await joinTeam(deps, { teamId: 'team-1', userId: 'u1', token: 'tok' })
      expect(out).toEqual({ ok: false, reason })
    })
  })

  // ─── activity feed ───────────────────────────────────────────────────────────
  describe('listActivity', () => {
    it('lists for a member of any role', async () => {
      const list = vi.fn(async () => ({ items: [], total: 3 }))
      const { deps } = makeDeps({ org: { getMemberRole: async () => 'viewer' } })
      deps.audit.list = list
      const out = await listActivity(deps, { teamId: 'team-1', userId: 'u1', page: 1, pageSize: 20 })
      expect(out).toEqual({ ok: true, result: { items: [], total: 3 } })
      expect(list).toHaveBeenCalledWith('team-1', { page: 1, pageSize: 20 })
    })

    it('lets a non-member read a personal org (public to auth users)', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => null, isPersonalOrg: async () => true } })
      const out = await listActivity(deps, { teamId: 'p-1', userId: 'u2', page: 2, pageSize: 5 })
      expect(out.ok).toBe(true)
    })

    it('forbids a non-member of a non-personal org', async () => {
      const { deps } = makeDeps({ org: { getMemberRole: async () => null, isPersonalOrg: async () => false } })
      const out = await listActivity(deps, { teamId: 'team-1', userId: 'u2', page: 1, pageSize: 20 })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
    })
  })

  // ─── org logo ────────────────────────────────────────────────────────────────
  describe('setTeamLogo', () => {
    const file = new File([new Uint8Array(8)], 'logo.png', { type: 'image/png' })

    it.each(['owner', 'admin'] as const)('uploads and sets logo for %s', async (role) => {
      const setLogo = vi.fn(async () => {})
      const upload = vi.fn(async () => ({ ok: true, url: 'https://cdn/x.png' }) as ImageUploadResult)
      const { deps } = makeDeps({
        org: { getMemberRole: async () => role },
        teams: { setLogo },
        imageUpload: { uploadPublicImage: upload },
      })
      const out = await setTeamLogo(deps, { platform, teamId: 'team-1', userId: 'u1', file })
      expect(out).toEqual({ ok: true, url: 'https://cdn/x.png' })
      expect(upload).toHaveBeenCalledWith(platform, '_system/org-logos', 'team-1', file)
      expect(setLogo).toHaveBeenCalledWith('team-1', 'https://cdn/x.png')
    })

    it('forbids a member and skips upload', async () => {
      const upload = vi.fn(async () => ({ ok: true, url: 'x' }) as ImageUploadResult)
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'member' },
        imageUpload: { uploadPublicImage: upload },
      })
      const out = await setTeamLogo(deps, { platform, teamId: 'team-1', userId: 'u1', file })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
      expect(upload).not.toHaveBeenCalled()
    })

    it.each([400, 413, 503] as const)('threads upload status %d outward', async (status) => {
      const setLogo = vi.fn(async () => {})
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'owner' },
        teams: { setLogo },
        imageUpload: { uploadPublicImage: async () => ({ ok: false, status, error: 'bad' }) },
      })
      const out = await setTeamLogo(deps, { platform, teamId: 'team-1', userId: 'u1', file })
      expect(out).toEqual({ ok: false, reason: 'upload_failed', status, error: 'bad' })
      expect(setLogo).not.toHaveBeenCalled()
    })
  })

  describe('deleteTeamLogo', () => {
    it.each(['owner', 'admin'] as const)('clears logo and deletes variants for %s', async (role) => {
      const setLogo = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const { deps } = makeDeps({
        org: { getMemberRole: async () => role },
        teams: { setLogo },
        imageUpload: { deletePublicImageVariants: del },
      })
      const out = await deleteTeamLogo(deps, { platform, teamId: 'team-1', userId: 'u1' })
      expect(out).toEqual({ ok: true })
      expect(setLogo).toHaveBeenCalledWith('team-1', null)
      expect(del).toHaveBeenCalledWith(platform, '_system/org-logos', 'team-1')
    })

    it('forbids a member and touches nothing', async () => {
      const setLogo = vi.fn(async () => {})
      const del = vi.fn(async () => {})
      const { deps } = makeDeps({
        org: { getMemberRole: async () => 'member' },
        teams: { setLogo },
        imageUpload: { deletePublicImageVariants: del },
      })
      const out = await deleteTeamLogo(deps, { platform, teamId: 'team-1', userId: 'u1' })
      expect(out).toEqual({ ok: false, reason: 'forbidden' })
      expect(setLogo).not.toHaveBeenCalled()
      expect(del).not.toHaveBeenCalled()
    })
  })

  // ─── admin: listing / detail ───────────────────────────────────────────────
  describe('listTeams', () => {
    it('wraps the repo list with a total', async () => {
      const { deps } = makeDeps({ teams: { listTeams: async () => [sampleTeam, { ...sampleTeam, id: 'team-2' }] } })
      const out = await listTeams(deps)
      expect(out.total).toBe(2)
      expect(out.items).toHaveLength(2)
    })
  })

  describe('getTeam', () => {
    it('returns the team record', async () => {
      const { deps } = makeDeps({ teams: { getTeam: async () => sampleTeam } })
      expect(await getTeam(deps, 'team-1')).toBe(sampleTeam)
    })

    it('returns null when missing', async () => {
      const { deps } = makeDeps({ teams: { getTeam: async () => null } })
      expect(await getTeam(deps, 'nope')).toBeNull()
    })
  })

  // ─── admin: entitlements ───────────────────────────────────────────────────
  const failure: UserOperationFailure = { error: 'Org not found', status: 404 }

  describe('listTeamEntitlements', () => {
    it('returns the entitlement list', async () => {
      const { deps } = makeDeps({
        userAdmin: { listOrgEntitlements: async () => ({ orgId: 'team-1', items: [sampleEntitlement] }) },
      })
      const out = await listTeamEntitlements(deps, 'team-1')
      expect(out).toEqual({ ok: true, result: { orgId: 'team-1', items: [sampleEntitlement] } })
    })

    it('threads a repo failure outward', async () => {
      const { deps } = makeDeps({ userAdmin: { listOrgEntitlements: async () => failure } })
      const out = await listTeamEntitlements(deps, 'nope')
      expect(out).toEqual({ ok: false, failure })
    })
  })

  describe('grantTeamEntitlement', () => {
    it('grants an entitlement', async () => {
      const grant = vi.fn(async () => sampleResult)
      const { deps } = makeDeps({ userAdmin: { grantOrgEntitlement: grant } })
      const out = await grantTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'team-1',
        resourceType: 'storage',
        bytes: 1024,
        expiresAt: null,
        note: 'starter',
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(grant).toHaveBeenCalledWith({
        adminUserId: 'admin',
        orgId: 'team-1',
        resourceType: 'storage',
        bytes: 1024,
        expiresAt: null,
        note: 'starter',
      })
    })

    it('threads a repo failure', async () => {
      const { deps } = makeDeps({ userAdmin: { grantOrgEntitlement: async () => failure } })
      const out = await grantTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'nope',
        resourceType: 'storage',
        bytes: 1024,
      })
      expect(out).toEqual({ ok: false, failure })
    })
  })

  describe('updateTeamEntitlement', () => {
    it('updates an entitlement', async () => {
      const update = vi.fn(async () => sampleResult)
      const { deps } = makeDeps({ userAdmin: { updateOrgEntitlement: update } })
      const out = await updateTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'team-1',
        entitlementId: 'ent-1',
        bytes: 4096,
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'team-1', entitlementId: 'ent-1', bytes: 4096 }),
      )
    })

    it('threads a repo failure', async () => {
      const { deps } = makeDeps({ userAdmin: { updateOrgEntitlement: async () => failure } })
      const out = await updateTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'team-1',
        entitlementId: 'ent-x',
      })
      expect(out).toEqual({ ok: false, failure })
    })
  })

  describe('revokeTeamEntitlement', () => {
    it('revokes an entitlement', async () => {
      const revoke = vi.fn(async () => sampleResult)
      const { deps } = makeDeps({ userAdmin: { revokeOrgEntitlement: revoke } })
      const out = await revokeTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'team-1',
        entitlementId: 'ent-1',
      })
      expect(out).toEqual({ ok: true, result: sampleResult })
      expect(revoke).toHaveBeenCalledWith({ adminUserId: 'admin', orgId: 'team-1', entitlementId: 'ent-1' })
    })

    it('threads a repo failure', async () => {
      const { deps } = makeDeps({ userAdmin: { revokeOrgEntitlement: async () => failure } })
      const out = await revokeTeamEntitlement(deps, {
        adminUserId: 'admin',
        targetOrgId: 'team-1',
        entitlementId: 'ent-x',
      })
      expect(out).toEqual({ ok: false, failure })
    })
  })
})
