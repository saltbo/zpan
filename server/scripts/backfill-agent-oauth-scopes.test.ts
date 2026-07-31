import { describe, expect, it } from 'vitest'
import { buildAgentOAuthScopeBackfill } from '../../scripts/backfill-agent-oauth-scopes'
import { AGENT_OAUTH_SCOPES } from '../../shared/agent-oauth'
import { AuthorizationScope } from '../../shared/authorization'

describe('buildAgentOAuthScopeBackfill', () => {
  it('updates ZPan resources and upload clients without expanding read-only clients', () => {
    const changes = buildAgentOAuthScopeBackfill(
      [
        {
          id: 'zpan-resource',
          name: 'ZPan API',
          allowedScopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
        {
          id: 'other-resource',
          name: 'Other API',
          allowedScopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
      ],
      [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE]),
        },
        {
          id: 'read-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_READ]),
        },
      ],
    )

    expect(changes).toEqual({
      resources: [{ id: 'zpan-resource', scopes: JSON.stringify(AGENT_OAUTH_SCOPES) }],
      clients: [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE]),
        },
      ],
    })
  })

  it('is idempotent after the scopes are current', () => {
    const changes = buildAgentOAuthScopeBackfill(
      [{ id: 'zpan-resource', name: 'ZPan API', allowedScopes: JSON.stringify(AGENT_OAUTH_SCOPES) }],
      [
        {
          id: 'upload-client',
          scopes: JSON.stringify([AuthorizationScope.OBJECTS_CREATE, AuthorizationScope.QUOTA_PURCHASE]),
        },
      ],
    )

    expect(changes).toEqual({ resources: [], clients: [] })
  })
})
