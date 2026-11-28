import type { SiteInvitation } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { EmailGateway, SiteInvitationRepo } from '../ports'
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
  const isConfigured = vi.fn(async (_platform: Platform) => true)
  const send = vi.fn(async (_platform: Platform, _message: { to: string; subject: string; html: string }) => {})
  const getSiteName = vi.fn(async () => 'ZPan Test')

  const siteInvitations: SiteInvitationRepo = {
    getSiteName,
    listSiteInvitations: async () => ({ items: [], nextBoundary: null }),
    createSiteInvitation: async () => sampleInvitation,
    resendSiteInvitation: async () => sampleInvitation,
    revokeSiteInvitation: async () => 'ok',
    getSiteInvitationByToken: async () => null,
    validateSiteInvitation: async () => ({ valid: true }),
    acceptSiteInvitation: async () => 'ok',
    ...overrides.siteInvitations,
  }
  const email = {
    getConfig: async () => ({ provider: 'http', from: 'a@b.c', http: { url: 'u', apiKey: 'k' } }),
    getSettings: async () => ({ enabled: true, config: null }),
    isConfigured,
    send,
    ...overrides.email,
  } as unknown as EmailGateway

  const deps: SiteInvitationDeps = {
    siteInvitations,
    email,
  }
  return { deps, isConfigured, send, getSiteName }
}

beforeEach(() => vi.clearAllMocks())

describe('site-invitation usecase', () => {
  it('listSiteInvitations forwards the repo result', async () => {
    const { deps } = makeDeps({
      siteInvitations: { listSiteInvitations: async () => ({ items: [sampleInvitation], nextBoundary: null }) },
    })
    expect(await listSiteInvitations(deps, { pageSize: 50 })).toEqual({ items: [sampleInvitation], nextBoundary: null })
  })

  it('listSiteInvitations passes the page size and boundary through', async () => {
    const list = vi.fn(async () => ({ items: [], nextBoundary: null }))
    const { deps } = makeDeps({ siteInvitations: { listSiteInvitations: list } })
    const after = { createdAt: new Date(1000), id: 'inv-1' }
    await listSiteInvitations(deps, { pageSize: 25, after })
    expect(list).toHaveBeenCalledWith({ pageSize: 25, after })
  })

  describe('createSiteInvitation', () => {
    it('validates email config, creates, and sends the invite', async () => {
      const create = vi.fn(async () => sampleInvitation)
      const { deps, isConfigured, send, getSiteName } = makeDeps({
        siteInvitations: { createSiteInvitation: create },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        email: 'invitee@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      expect(out).toEqual({ ok: true, invitation: sampleInvitation })
      expect(isConfigured).toHaveBeenCalledWith(platform)
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
    })

    it.each([
      ['pending_exists', 'A pending invitation already exists for this email', '该邮箱已有待接受的邀请'],
      ['user_exists', 'A user with this email already exists', '该邮箱已注册'],
    ] as const)('answers the %s conflict with 409 without sending [spec: site-invitations/duplicate]', async (result, en, zh) => {
      const { deps, send } = makeDeps({ siteInvitations: { createSiteInvitation: async () => result } })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        email: 'dupe@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(409)
      expect(out.error.message).toBe(en)
      expect(out.error.localizedMessage('zh')).toBe(zh)
      expect(send).not.toHaveBeenCalled()
    })

    it('answers a failure to save with 500 and a product message, keeping its text for the log [spec: error-messages/exception-text]', async () => {
      const { deps, send } = makeDeps({
        siteInvitations: {
          createSiteInvitation: async () => {
            throw new Error('D1_ERROR: database is locked')
          },
        },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        email: 'new@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(500)
      expect(out.error.message).toBe('Failed to create invitation')
      expect(out.error.meta.diagnostics?.message).toBe('D1_ERROR: database is locked')
      expect(send).not.toHaveBeenCalled()
    })

    it('answers a non-Error failure with 500 and the default message', async () => {
      const { deps } = makeDeps({
        siteInvitations: {
          createSiteInvitation: async () => {
            throw 'boom'
          },
        },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        email: 'new@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(500)
      expect(out.error.message).toBe('Failed to create invitation')
    })

    it('returns emailNotConfigured without creating when email is not configured', async () => {
      const create = vi.fn(async () => sampleInvitation)
      const { deps, send } = makeDeps({
        siteInvitations: { createSiteInvitation: create },
        email: { isConfigured: async () => false },
      })
      const out = await createSiteInvitation(deps, platform, {
        userId: 'u1',
        email: 'invitee@example.com',
        requestUrl: 'https://app.example.com/api/admin/site-invitations',
      })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Configure email delivery before sending invitations')
      expect(out.error.meta).toMatchObject({ reason: 'EMAIL_NOT_CONFIGURED', canonicalStatus: 'FAILED_PRECONDITION' })
      expect(create).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
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

    it('returns emailNotConfigured without rotating when email is not configured', async () => {
      const resend = vi.fn(async () => sampleInvitation)
      const { deps, send } = makeDeps({
        siteInvitations: { resendSiteInvitation: resend },
        email: { isConfigured: async () => false },
      })
      const out = await resendSiteInvitation(deps, platform, { id: 'inv-1', requestUrl: 'https://app.example.com/r' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Configure email delivery before sending invitations')
      expect(resend).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('returns not_found and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'not_found' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(404)
      expect(out.error.message).toBe('Invitation not found')
      expect(send).not.toHaveBeenCalled()
    })

    it('returns already_accepted and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'already_accepted' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Invitation has already been used')
      expect(send).not.toHaveBeenCalled()
    })

    it('returns already_revoked and does not send', async () => {
      const { deps, send } = makeDeps({ siteInvitations: { resendSiteInvitation: async () => 'already_revoked' } })
      const out = await resendSiteInvitation(deps, platform, { id: 'x', requestUrl: 'https://app.example.com/r' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Invitation has been revoked')
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('revokeSiteInvitation', () => {
    it('revokes the invitation', async () => {
      const revoke = vi.fn(async () => 'ok' as const)
      const { deps } = makeDeps({ siteInvitations: { revokeSiteInvitation: revoke } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', id: 'inv-1' })
      expect(out).toEqual({ ok: true, id: 'inv-1' })
      expect(revoke).toHaveBeenCalledWith('inv-1', 'u1')
    })

    it('returns not_found', async () => {
      const { deps } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'not_found' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', id: 'x' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(404)
      expect(out.error.message).toBe('Invitation not found')
    })

    it('returns already_accepted', async () => {
      const { deps } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'already_accepted' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', id: 'inv-1' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Invitation has already been used')
    })

    it('returns already_revoked', async () => {
      const { deps } = makeDeps({ siteInvitations: { revokeSiteInvitation: async () => 'already_revoked' } })
      const out = await revokeSiteInvitation(deps, { userId: 'u1', id: 'inv-1' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Invitation has already been revoked')
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
