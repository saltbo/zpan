import {
  AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
  AGENT_OAUTH_CLIENT_ID,
  AGENT_OAUTH_CLIENT_NAME,
  AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
  AGENT_OAUTH_STANDARD_SCOPES,
  RESTISH_OAUTH_REDIRECT_URIS,
} from '@shared/agent-oauth'
import { isAuthorizationScope } from '@shared/authorization'
import { type AgentGrantableScope, type AgentOAuthConsentContext, agentGrantableScopeSchema } from '@shared/schemas'
import type { Deps } from './deps'
import { badRequest, forbidden } from './ports'

export async function getAgentOAuthConsentContext(
  deps: Pick<Deps, 'org'>,
  input: { userId: string; orgId: string | null; requestUrl: string; oauthQuery: string },
): Promise<AgentOAuthConsentContext> {
  const params = new URLSearchParams(input.oauthQuery)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const responseType = params.get('response_type')
  const scopeValue = params.get('scope') ?? ''

  if (clientId !== AGENT_OAUTH_CLIENT_ID || responseType !== 'code' || !redirectUri) {
    throw badRequest('Invalid Agent OAuth request')
  }
  if (!RESTISH_OAUTH_REDIRECT_URIS.includes(redirectUri as (typeof RESTISH_OAUTH_REDIRECT_URIS)[number])) {
    throw badRequest('Invalid Agent OAuth redirect URI')
  }

  const requestedScopes = scopeValue.split(/\s+/).filter(Boolean)
  const standardScopes = requestedScopes.filter((scope) =>
    (AGENT_OAUTH_STANDARD_SCOPES as readonly string[]).includes(scope),
  )
  const scopes = requestedScopes.filter(isAgentGrantableScope)
  if (scopes.length === 0 || requestedScopes.length !== standardScopes.length + scopes.length) {
    throw badRequest('Invalid Agent OAuth scope')
  }

  const orgId = input.orgId
  if (!orgId || !(await deps.org.canReadOrg(input.userId, orgId))) {
    throw forbidden('Workspace access is required for Agent OAuth')
  }
  const names = await deps.org.getOrgNames([orgId])

  return {
    clientId,
    clientName: AGENT_OAUTH_CLIENT_NAME,
    instanceOrigin: new URL(input.requestUrl).origin,
    workspace: { id: orgId, name: names.get(orgId) ?? null },
    scopes,
    standardScopes,
    redirectUri,
    grantLifetime: {
      accessTokenSeconds: AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
      refreshTokenSeconds: AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
    },
  }
}

function isAgentGrantableScope(scope: string): scope is AgentGrantableScope {
  return isAuthorizationScope(scope) && agentGrantableScopeSchema.safeParse(scope).success
}
