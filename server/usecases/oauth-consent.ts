import { isAuthorizationScope } from '@shared/authorization'
import { OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_REFRESH_TOKEN_SECONDS, OAUTH_STANDARD_SCOPES } from '@shared/oauth'
import { type OAuthConsentContext, type OAuthResourceScope, oauthResourceScopeSchema } from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { badRequest, forbidden } from './ports'

export async function getOAuthConsentContext(
  deps: Pick<Deps, 'oauth' | 'org'>,
  input: { db: Database; userId: string; orgId: string | null; requestUrl: string; oauthQuery: string },
): Promise<OAuthConsentContext> {
  const params = new URLSearchParams(input.oauthQuery)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const responseType = params.get('response_type')
  const scopeValue = params.get('scope') ?? ''

  if (!clientId || responseType !== 'code' || !redirectUri) {
    throw badRequest('Invalid OAuth request')
  }
  const client = await deps.oauth.findClient(input.db, clientId)
  if (
    !client ||
    client.disabled ||
    !client.responseTypes.includes('code') ||
    !client.redirectUris.includes(redirectUri)
  ) {
    throw badRequest('Invalid OAuth redirect URI')
  }

  const requestedScopes = scopeValue.split(/\s+/).filter(Boolean)
  const standardScopes = requestedScopes.filter((scope) => (OAUTH_STANDARD_SCOPES as readonly string[]).includes(scope))
  const scopes = requestedScopes.filter(isOAuthResourceScope)
  if (
    scopes.length === 0 ||
    requestedScopes.length !== standardScopes.length + scopes.length ||
    requestedScopes.some((scope) => !client.scopes.includes(scope))
  ) {
    throw badRequest('Invalid OAuth scope')
  }

  const orgId = input.orgId
  if (!orgId || !(await deps.org.canReadOrg(input.userId, orgId))) {
    throw forbidden('Workspace access is required for OAuth')
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
      accessTokenSeconds: OAUTH_ACCESS_TOKEN_SECONDS,
      refreshTokenSeconds: OAUTH_REFRESH_TOKEN_SECONDS,
    },
  }
}

function isOAuthResourceScope(scope: string): scope is OAuthResourceScope {
  return isAuthorizationScope(scope) && oauthResourceScopeSchema.safeParse(scope).success
}
