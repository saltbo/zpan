import {
  AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
  AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
  AGENT_OAUTH_STANDARD_SCOPES,
} from '@shared/agent-oauth'
import { isAuthorizationScope } from '@shared/authorization'
import { type AgentOAuthConsentContext, type OAuthResourceScope, oauthResourceScopeSchema } from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { badRequest, forbidden } from './ports'

export async function getAgentOAuthConsentContext(
  deps: Pick<Deps, 'agentOAuth' | 'org'>,
  input: { db: Database; userId: string; orgId: string | null; requestUrl: string; oauthQuery: string },
): Promise<AgentOAuthConsentContext> {
  const params = new URLSearchParams(input.oauthQuery)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const responseType = params.get('response_type')
  const scopeValue = params.get('scope') ?? ''

  if (!clientId || responseType !== 'code' || !redirectUri) {
    throw badRequest('Invalid Agent OAuth request')
  }
  const client = await deps.agentOAuth.findClient(input.db, clientId)
  if (
    !client ||
    client.disabled ||
    !client.responseTypes.includes('code') ||
    !client.redirectUris.includes(redirectUri)
  ) {
    throw badRequest('Invalid Agent OAuth redirect URI')
  }

  const requestedScopes = scopeValue.split(/\s+/).filter(Boolean)
  const standardScopes = requestedScopes.filter((scope) =>
    (AGENT_OAUTH_STANDARD_SCOPES as readonly string[]).includes(scope),
  )
  const scopes = requestedScopes.filter(isOAuthResourceScope)
  if (
    scopes.length === 0 ||
    requestedScopes.length !== standardScopes.length + scopes.length ||
    requestedScopes.some((scope) => !client.scopes.includes(scope))
  ) {
    throw badRequest('Invalid Agent OAuth scope')
  }

  const orgId = input.orgId
  if (!orgId || !(await deps.org.canReadOrg(input.userId, orgId))) {
    throw forbidden('Workspace access is required for Agent OAuth')
  }
  const names = await deps.org.getOrgNames([orgId])

  return {
    clientId,
    clientName: client.clientName,
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

function isOAuthResourceScope(scope: string): scope is OAuthResourceScope {
  return isAuthorizationScope(scope) && oauthResourceScopeSchema.safeParse(scope).success
}
