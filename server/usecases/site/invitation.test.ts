import type { SiteInvitation } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { ActivityRepo, EmailGateway, SiteInvitationRepo } from '../ports'
import {
  createSiteInvitation,
  getSiteInvitationByToken,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
  type SiteInvitationDeps,
} from './invitation'

const platform = {} as Platform

const sampleInvitation: SiteInvitation = {
  id: 'inv-1',
  email: 'invitee@example.com',
  token: 'tok-1',
  status: 'pending',
  expiresAt: '2030-01-01T00:00:00.000Z',
} as SiteInvitation

function makeDeps(overrides: { siteInvitations?: Partial<SiteInvitationRepo>; email?: Partial<EmailGateway> } = {}) {
  const record = vi.fn(async () => {})
  const getConfig = vi.fn(async () => ({ provider: 'http', from: 'a@b.c', http: { url: 'u', apiKey: 'k' } }))
  const send = vi.fn(async (_platform: Platform, _message: { to: string; subject: string; html: string }) => {})
  const getSiteName = vi.fn(async () => 'ZPan Test')

  const siteInvitations: SiteInvitationRepo = {
    getSiteName,
    listSiteInvitations: async () => ({ items: [], total: 0 }),
    createSiteInvitation: async () => sampleInvitation,
    resendSiteInvitation: async () => sampleInvitation,
    revokeSiteInvitation: async () => 'ok',
    getSiteInvitationByToken: async () => null,
    validateSiteInvitation: async () => ({ valid: true }),
    acceptSiteInvitation: async () => 'ok',
    ...overrides.siteInvitations,
  }
  const email = {
    getConfig,
    getSettings: async () => ({ enabled: true, config: null }),
    isConfigured: async () => true,
    send,
    ...overrides.email,
  } as unknown as EmailGateway

  const deps: SiteInvitationDeps = {
    siteInvitations,
    email,
    activity: { record } as unknown as ActivityRepo,
  }
  return { deps, record, getConfig, send, getSiteName }
}

beforeEach(() => vi.clearAllMocks())

describe('site-invitation usecase', () => {
  it('listSiteInvitations forwards the repo result', async () => {
    const { deps } = makeDeps({
      siteInvitations: { listSiteInvitations: async () => ({ items: [sampleInvitation], total: 1 }) },
    })
    expect(await listSiteInvitations(deps, 2, 50)).toEqual({ items: [sampleInvitation], total: 1 })
  })

  it('listSiteInvitations passes page and pageSize through', async () => {
    const list = vi.fn(async () => ({ items: [], total: 0 }))
    const { deps } = makeDeps({ siteInvitations: { listSiteInvitations: list } })
    await listSiteInvitations(deps, 3, 25)
    expect(list).toHaveBeenCalledWith(3, 25)
  })

  describe('createSiteInvitation', () => {
    it('validates email config, creates, sends the invite, and records activity', async () => {
      const create = vi.fn(async () => sampleInvitation)
      const { deps, record, getConfig, send, getSiteName } = makeDeps({
        siteInvitations: { createSiteInvitation: create },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        orgId: 'o1',
        email: 'invitee@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      expect(out).toEqual({ ok: true, invitation: sampleInvitation })
      expect(getConfig).toHaveBeenCalledWith(platform)
      expect(create).toHaveBeenCalledWith('u1', 'invitee@example.com')
      expect(getSiteName).toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith(
        platform,
        expect.objectContaining({
          to: 'invitee@example.com',
          subject: "You're invited to register on ZPan Test",
        }),
      )
      // Invite link is rooted at the request origin and carries the token.
      const sentHtml = send.mock.calls[0]![1].html as string
      expect(sentHtml).toContain('https://app.example.com/sign-up?invite=tok-1')
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'site_invitation_create',
          targetType: 'site_invitation',
          targetId: 'inv-1',
          targetName: 'invitee@example.com',
          orgId: 'o1',
          userId: 'u1',
        }),
      )
    })

    it('returns conflict with the thrown message on a duplicate, without sending or recording', async () => {
      const { deps, record, send } = makeDeps({
        siteInvitations: {
          createSiteInvitation: async () => {
            throw new Error('Invitation already exists')
          },
        },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        orgId: 'o1',
        email: 'dupe@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      expect(out).toEqual({ ok: false, reason: 'conflict', message: 'Invitation already exists' })
      expect(send).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it('falls back to a default message when a non-Error is thrown', async () => {
      const { deps } = makeDeps({
        siteInvitations: {
          createSiteInvitation: async () => {
            throw 'boom'
          },
        },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        orgId: 'o1',
        email: 'dupe@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      expect(out).toEqual({ ok: false, reason: 'conflict', message: 'Failed to create invitation' })
    })

    it('propagates when email config validation throws, before creating', async () => {
      const create = vi.fn(async () => sampleInvitation)
      const { deps } = makeDeps({
        siteInvitations: { createSiteInvitation: create },
        email: {
          getConfig: async () => {
            throw new Error('Email not configured')
          },
        },
      })
      await expect(
        createSiteInvitation(deps, platform, {
          userId: 'u1',
          orgId: 'o1',
          email: 'invitee@example.com',
          requestUrl: 'https://app.example.com/api/admin/site-invitations',
        }),
      ).rejects.toThrow('Email not configured')
      expect(create).not.toHaveBeenCalled()
    })
  })

  describe('resendSiteInvitation', () => {
    it('resends the rotated invitation and emails it', async () => {
      const rotated = { ...sampleInvitation, token: 'tok-2' }
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => rotated } })
      const out = await resendSiteInvitation(deps, platform, {
        id: 'inv-1',
        requestUrl: 'https://app.example.com/api/admin/site-invitations/inv-1/resend',
      })
      expect(out).toEqual({ ok: true, invitation: rotated })
      const sentHtml = send.mock.calls[0]![1].html as string
      expect(sentHtml).toContain('invite=tok-2')
    })

    it('returns not_found and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'not_found' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
      expect(send).not.toHaveBeenCalled()
    })

    it('returns already_accepted and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'already_accepted' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out).toEqual({ ok: false, reason: 'already_accepted' })
      expect(send).not.toHaveBeenCalled()
    })

    it('returns already_revoked and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'already_revoked' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out).toEqual({ ok: false, reason: 'already_revoked' })
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('revokeSiteInvitation', () => {
    it('revokes and records activity', async () => {
      const revoke = vi.fn(async () => 'ok' as const)
      const { deps, record } = makeDeps({ siteInvitations: { revokeSiteInvitation: revoke } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', orgId: 'o1', id: 'inv-1' })
      expect(out).toEqual({ ok: true, id: 'inv-1' })
      expect(revoke).toHaveBeenCalledWith('inv-1', 'u1')
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'site_invitation_revoke',
          targetType: 'site_invitation',
          targetId: 'inv-1',
          targetName: 'inv-1',
          orgId: 'o1',
          userId: 'u1',
        }),
      )
    })

    it('returns not_found without recording', async () => {
      const { deps, record } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'not_found' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', orgId: 'o1', id: 'x' })
      expect(out).toEqual({ ok: false, reason: 'not_found' })
      expect(record).not.toHaveBeenCalled()
    })

    it('returns already_accepted without recording', async () => {
      const { deps, record } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'already_accepted' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', orgId: 'o1', id: 'inv-1' })
      expect(out).toEqual({ ok: false, reason: 'already_accepted' })
      expect(record).not.toHaveBeenCalled()
    })

    it('returns already_revoked without recording', async () => {
      const { deps, record } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'already_revoked' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', orgId: 'o1', id: 'inv-1' })
      expect(out).toEqual({ ok: false, reason: 'already_revoked' })
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('getSiteInvitationByToken', () => {
    it('returns the invitation when found', async () => {
      const { deps } = makeDeps({ siteInvitations: { getSiteInvitationByToken: async () => sampleInvitation } })
      expect(await getSiteInvitationByToken(deps, 'tok-1')).toBe(sampleInvitation)
    })

    it('returns null when missing', async () => {
      const { deps } = makeDeps({ siteInvitations: { getSiteInvitationByToken: async () => null } })
      expect(await getSiteInvitationByToken(deps, 'nope')).toBeNull()
    })
  })
})
