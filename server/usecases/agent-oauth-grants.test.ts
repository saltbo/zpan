import { describe, expect, it, vi } from 'vitest'
import { listAgentOAuthGrants, revokeAgentOAuthGrant } from './agent-oauth-grants'
import type { AgentOAuthGateway } from './ports'

const db = {} as never

function gateway(overrides: Partial<AgentOAuthGateway> = {}): AgentOAuthGateway {
  return {
    ensureSystemClient: vi.fn(),
    assertLiveGrant: vi.fn(),
    verifyAccessToken: vi.fn(),
    listGrants: vi.fn(async () => []),
    revokeGrant: vi.fn(async () => true),
    ...overrides,
  }
}

describe('Agent OAuth grant usecases', () => {
  it('lists grants through the gateway', async () => {
    const agentOAuth = gateway({
      listGrants: vi.fn(async () => [
        {
          id: 'grant-1',
          clientId: 'zpan-agent',
          userId: 'user-1',
          orgId: 'org-1',
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          updatedAt: '2026-07-29T12:00:00.000Z',
        },
      ]),
    })

    await expect(listAgentOAuthGrants({ agentOAuth }, db, { userId: 'user-1' })).resolves.toEqual({
      items: [
        {
          id: 'grant-1',
          clientId: 'zpan-agent',
          userId: 'user-1',
          orgId: 'org-1',
          scopes: [],
          createdAt: '2026-07-29T12:00:00.000Z',
          updatedAt: '2026-07-29T12:00:00.000Z',
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
