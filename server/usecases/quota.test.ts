import { describe, expect, it, vi } from 'vitest'
import type { EffectiveQuota, OrgQuotaOverviewRow } from './ports'
import { getUserQuota, getUsersQuota, listQuotaOverview } from './quota'

const eff = (orgId: string) => ({ orgId }) as EffectiveQuota
const quotaOf = (orgId: string, used: number, total: number) => ({ orgId, used, quota: total }) as EffectiveQuota

describe('quota usecase', () => {
  describe('listQuotaOverview', () => {
    it('joins overview rows with effective quotas and parses org type', async () => {
      const rows: OrgQuotaOverviewRow[] = [
        { id: 'q1', orgId: 'o1', orgName: 'Team A', orgMetadata: '{"type":"team"}' },
        { id: 'q2', orgId: 'o2', orgName: 'Personal', orgMetadata: null },
      ]
      const out = await listQuotaOverview({
        quota: {
          listOrgQuotaOverview: async () => rows,
          getEffectiveQuotasByOrg: async () =>
            new Map([
              ['o1', eff('o1')],
              ['o2', eff('o2')],
            ]),
        },
      })
      expect(out.total).toBe(2)
      expect(out.items[0]).toMatchObject({ id: 'q1', orgId: 'o1', orgName: 'Team A', orgType: 'team' })
      expect(out.items[1]).toMatchObject({ id: 'q2', orgName: 'Personal', orgType: 'unknown' })
    })

    it('falls back to unknown org type on malformed metadata', async () => {
      const rows: OrgQuotaOverviewRow[] = [{ id: 'q1', orgId: 'o1', orgName: 'X', orgMetadata: 'not json' }]
      const out = await listQuotaOverview({
        quota: {
          listOrgQuotaOverview: async () => rows,
          getEffectiveQuotasByOrg: async () => new Map([['o1', eff('o1')]]),
        },
      })
      expect(out.items[0].orgType).toBe('unknown')
    })
  })

  describe('getUserQuota', () => {
    it('uses the provided orgId without the personal-org lookup', async () => {
      const getEffectiveQuota = vi.fn(async () => eff('o1'))
      const findPersonalOrg = vi.fn(async () => null)
      const out = await getUserQuota(
        { quota: { getEffectiveQuota }, org: { findPersonalOrg } },
        { userId: 'u1', orgId: 'o1' },
      )
      expect(out).toEqual(eff('o1'))
      expect(getEffectiveQuota).toHaveBeenCalledWith('o1')
      expect(findPersonalOrg).not.toHaveBeenCalled()
    })

    it('falls back to the personal org when no orgId is given', async () => {
      const getEffectiveQuota = vi.fn(async () => eff('personal'))
      await getUserQuota(
        { quota: { getEffectiveQuota }, org: { findPersonalOrg: async () => 'personal' } },
        { userId: 'u1' },
      )
      expect(getEffectiveQuota).toHaveBeenCalledWith('personal')
    })

    it('returns null when the user has no org', async () => {
      const out = await getUserQuota(
        { quota: { getEffectiveQuota: async () => eff('x') }, org: { findPersonalOrg: async () => null } },
        { userId: 'u1' },
      )
      expect(out).toBeNull()
    })
  })

  describe('getUsersQuota', () => {
    it('maps each user to its personal-org used/total', async () => {
      const personalOrgs: Record<string, string> = { u1: 'o1', u2: 'o2' }
      const getEffectiveQuotasByOrg = vi.fn(
        async () =>
          new Map([
            ['o1', quotaOf('o1', 100, 1000)],
            ['o2', quotaOf('o2', 50, 500)],
          ]),
      )
      const out = await getUsersQuota(
        {
          quota: { getEffectiveQuotasByOrg },
          org: { findPersonalOrg: async (id: string) => personalOrgs[id] ?? null },
        },
        ['u1', 'u2'],
      )
      expect(getEffectiveQuotasByOrg).toHaveBeenCalledWith(expect.arrayContaining(['o1', 'o2']), expect.any(Date))
      expect(out).toEqual(
        expect.arrayContaining([
          { userId: 'u1', used: 100, total: 1000 },
          { userId: 'u2', used: 50, total: 500 },
        ]),
      )
    })

    it('omits users without a personal org', async () => {
      const out = await getUsersQuota(
        {
          quota: { getEffectiveQuotasByOrg: async () => new Map([['o1', quotaOf('o1', 1, 2)]]) },
          org: { findPersonalOrg: async (id: string) => (id === 'u1' ? 'o1' : null) },
        },
        ['u1', 'orphan'],
      )
      expect(out).toEqual([{ userId: 'u1', used: 1, total: 2 }])
    })
  })
})
