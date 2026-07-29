import type { oauthProvider } from '@better-auth/oauth-provider'
import { APIError } from 'better-auth'
import {
  AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
  AGENT_OAUTH_CLIENT_ID,
  AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
  AGENT_OAUTH_SCOPES,
} from '../../shared/agent-oauth'
import { createOrgRepo } from '../adapters/repos/org'
import type { Database } from '../platform/interface'
import type { AgentOAuthGateway } from '../usecases/ports'

type AgentOAuthOrgLookup = Pick<ReturnType<typeof createOrgRepo>, 'findPersonalOrg' | 'getMemberRole'>
type AgentOAuthProviderOptions = Parameters<typeof oauthProvider>[0]

export function createAgentOAuthProviderOptions(input: {
  db: Database
  agentOAuth: AgentOAuthGateway
  orgs?: AgentOAuthOrgLookup
}): AgentOAuthProviderOptions {
  const orgs = input.orgs ?? createOrgRepo(input.db)
  return {
    disableJwtPlugin: true,
    loginPage: '/sign-in',
    consentPage: '/settings/agent-access',
    accessTokenExpiresIn: AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
    refreshTokenExpiresIn: AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
    grantTypes: ['authorization_code', 'refresh_token'],
    scopes: [...AGENT_OAUTH_SCOPES],
    advertisedMetadata: { scopes_supported: [...AGENT_OAUTH_SCOPES] },
    cachedTrustedClients: new Set([AGENT_OAUTH_CLIENT_ID]),
    silenceWarnings: {
      oauthAuthServerConfig: true,
      openidConfig: true,
    },
    postLogin: {
      page: '/settings/agent-access',
      shouldRedirect: async () => false,
      consentReferenceId: async ({ user, session, scopes }) => {
        const clientScopes = scopes.filter((scope) => scope !== 'openid' && scope !== 'profile' && scope !== 'email')
        const grantableScopes = new Set<string>(AGENT_OAUTH_SCOPES)
        if (clientScopes.some((scope) => !grantableScopes.has(scope))) {
          throw new APIError('BAD_REQUEST', { error: 'invalid_scope', error_description: 'Scope is not grantable' })
        }
        const orgId = typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : null
        const selectedOrgId = orgId || (await orgs.findPersonalOrg(user.id))
        if (!selectedOrgId) {
          throw new APIError('BAD_REQUEST', {
            error: 'invalid_request',
            error_description: 'A workspace is required for Agent OAuth',
          })
        }
        const role = await orgs.getMemberRole(selectedOrgId, user.id)
        if (!role && selectedOrgId !== (await orgs.findPersonalOrg(user.id))) {
          throw new APIError('FORBIDDEN', {
            error: 'access_denied',
            error_description: 'Workspace access is required for Agent OAuth',
          })
        }
        return selectedOrgId
      },
    },
    customAccessTokenClaims: async ({ user, referenceId, scopes, metadata }) => {
      if (metadata?.client_id && metadata.client_id !== AGENT_OAUTH_CLIENT_ID) return {}
      if (!user?.id || !referenceId) {
        throw new APIError('BAD_REQUEST', {
          error: 'invalid_grant',
          error_description: 'Agent OAuth grant is missing workspace context',
        })
      }
      await input.agentOAuth.assertLiveGrant(input.db, {
        userId: user.id,
        clientId: AGENT_OAUTH_CLIENT_ID,
        orgId: referenceId,
        scopes,
      })
      return {
        zpan_org_id: referenceId,
        zpan_actor: 'agent_oauth',
      }
    },
  }
}
