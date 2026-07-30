import { describe, expect, it, vi } from 'vitest'
import { listAgentOAuthGrants, revokeAgentOAuthGrant } from './agent-oauth-grants'
import type { AgentOAuthGateway, OrgRepo } from './ports'

const db = {} as never

function gateway(overrides: Partial<AgentOAuthGateway> = {}): AgentOAuthGateway {
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
    findPersonalOrg: vi.fn(),
    getMemberRole: vi.fn(),
    getOrgNames: vi.fn(async () => new Map([['org-1', 'Personal']])),
    canReadOrg: vi.fn(),
    canWriteToOrg: vi.fn(),
    canManageAgentAccess: vi.fn(),
    isPersonalOrg: vi.fn(),
    ...overrides,
  }
}

describe('Agent OAuth grant usecases', () => {
  it('lists grants through the gateway', async () => {
    const agentOAuth = gateway({
      listGrants: vi.fn(async () => [
        {
          id: 'grant-1',
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          userId: 'user-1',
          orgId: 'org-1',
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: null,
        },
      ]),
    })

    await expect(listAgentOAuthGrants({ agentOAuth, org: org() }, db, { userId: 'user-1' })).resolves.toEqual({
      items: [
        {
          id: 'grant-1',
          clientId: 'dynamic-client',
          clientName: 'FlareAuth',
          userId: 'user-1',
          orgId: 'org-1',
          workspaceName: 'Personal',
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          lastUsedAt: null,
          status: 'active',
        },
      ],
    })
  })

  it('throws not found when revoke does not remove a grant', async () => {
    const agentOAuth = gateway({ revokeGrant: vi.fn(async () => false) })

    await expect(
      revokeAgentOAuthGrant({ agentOAuth }, db, { userId: 'user-1', grantId: 'missing' }),
    ).rejects.toMatchObject({
      httpStatus: 404,
      message: 'Agent OAuth grant not found',
    })
  })
})
