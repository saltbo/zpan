import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InviteCodeRecord, InviteRepo } from '../ports'
import {
  deleteInviteCode,
  generateInviteCodes,
  type InviteCodeDeps,
  listInviteCodes,
  validateInviteCode,
} from './invite-code'

const sampleCode = {
  id: 'ic-1',
  code: 'ABCD1234',
  createdBy: 'u1',
  usedBy: null,
  usedAt: null,
  expiresAt: null,
  createdAt: new Date('2026-01-01'),
} as InviteCodeRecord

function makeDeps(invites: Partial<InviteRepo> = {}) {
  const repo: InviteRepo = {
    generate: async () => [sampleCode],
    validate: async () => ({ valid: true }),
    redeem: async () => 'ok',
    list: async () => ({ items: [], total: 0 }),
    delete: async () => 'ok',
    ...invites,
  }
  const deps: InviteCodeDeps = {
    invites: repo,
  }
  return { deps }
}

beforeEach(() => vi.clearAllMocks())

describe('invite-code usecase', () => {
  describe('listInviteCodes', () => {
    it('forwards page and pageSize to the repo and returns its result', async () => {
      const list = vi.fn(async () => ({ items: [sampleCode], total: 1 }))
      const { deps } = makeDeps({ list })
      const out = await listInviteCodes(deps, { page: 2, pageSize: 5 })
      expect(out).toEqual({ items: [sampleCode], total: 1 })
      expect(list).toHaveBeenCalledWith(2, 5)
    })
  })

  describe('validateInviteCode', () => {
    it('forwards the code and returns a valid result', async () => {
      const validate = vi.fn(async () => ({ valid: true }))
      const { deps } = makeDeps({ validate })
      expect(await validateInviteCode(deps, 'ABCD1234')).toEqual({ valid: true })
      expect(validate).toHaveBeenCalledWith('ABCD1234')
    })

    it('returns the repo error verbatim for an invalid code', async () => {
      const { deps } = makeDeps({ validate: async () => ({ valid: false, error: 'Invalid invite code' }) })
      expect(await validateInviteCode(deps, 'NOSUCHCD')).toEqual({ valid: false, error: 'Invalid invite code' })
    })
  })

  describe('generateInviteCodes', () => {
    it('generates without an expiry', async () => {
      const generate = vi.fn(async () => [sampleCode, sampleCode])
      const { deps } = makeDeps({ generate })
      const out = await generateInviteCodes(deps, { userId: 'u1', count: 2 })
      expect(out).toEqual({ codes: [sampleCode, sampleCode] })
      expect(generate).toHaveBeenCalledWith('u1', 2, undefined)
    })

    it('translates expiresInDays into an absolute expiry Date', async () => {
      const now = new Date('2026-06-14T00:00:00.000Z')
      vi.useFakeTimers()
      vi.setSystemTime(now)
      const generate = vi.fn(async () => [sampleCode])
      const { deps } = makeDeps({ generate })
      await generateInviteCodes(deps, { userId: 'u1', count: 1, expiresInDays: 7 })
      const expectedExpiry = new Date(now.getTime() + 7 * 86400000)
      expect(generate).toHaveBeenCalledWith('u1', 1, expectedExpiry)
      vi.useRealTimers()
    })
  })

  describe('deleteInviteCode', () => {
    it('deletes an unused code', async () => {
      const del = vi.fn(async () => 'ok' as const)
      const { deps } = makeDeps({ delete: del })
      const out = await deleteInviteCode(deps, { id: 'ic-1' })
      expect(out).toEqual({ ok: true })
      expect(del).toHaveBeenCalledWith('ic-1')
    })

    it('returns not_found for a missing code', async () => {
      const { deps } = makeDeps({ delete: async () => 'not_found' })
      const out = await deleteInviteCode(deps, { id: 'x' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(404)
      expect(out.error.message).toBe('Invite code not found')
    })

    it('returns already_used for a redeemed code', async () => {
      const { deps } = makeDeps({ delete: async () => 'already_used' })
      const out = await deleteInviteCode(deps, { id: 'ic-1' })
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Cannot delete a used invite code')
    })
  })
})
