import { describe, expect, it, vi } from 'vitest'
import { listOAuthGrants, revokeOAuthGrant } from './oauth-grants'
import type { OAuthGateway, OrgRepo } from './ports'

const db = {} as never

function gateway(overrides: Partial<OAuthGateway> = {}): OAuthGateway {
  return {
    findClient: vi.fn(),
    listRegisteredApplications: vi.fn(),
    revokeJwtAccessToken: vi.fn(),
    isJwtAccessTokenRevoked: vi.fn(),
    listGrants: vi.fn(async () => []),
    revokeGrant: vi.fn(async () => true),
    ...overrides,
  }
}

function org(overrides: Partial<OrgRepo> = {}): OrgRepo {
  return {
    listUserOrgs: vi.fn(async () => []),
    findPersonalOrg: vi.fn(),
    getMemberRole: vi.fn(),
    getOrgNames: vi.fn(async () => new Map([['org-1', 'Personal']])),
    canReadOrg: vi.fn(),
    canWriteToOrg: vi.fn(),
    isPersonalOrg: vi.fn(),
    ...overrides,
  }
}

describe('OAuth grant usecases', () => {
  it('lists grants through the gateway', async () => {
    const oauth = gateway({
      listGrants: vi.fn(async () => [
        {
          id: 'grant-1',
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          userId: 'user-1',
          workspaceIds: ['org-1'],
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: null,
        },
      ]),
    })

    await expect(listOAuthGrants({ oauth, org: org() }, db, { userId: 'user-1' })).resolves.toEqual({
      items: [
        {
          id: 'grant-1',
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          userId: 'user-1',
          workspaces: [{ id: 'org-1', name: 'Personal' }],
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: null,
          status: 'active',
        },
      ],
    })
  })

  it('throws not found when revoke does not remove a grant', async () => {
    const oauth = gateway({ revokeGrant: vi.fn(async () => false) })

    await expect(revokeOAuthGrant({ oauth }, db, { userId: 'user-1', grantId: 'missing' })).rejects.toMatchObject({
      httpStatus: 404,
      message: 'OAuth grant not found',
    })
  })
})
