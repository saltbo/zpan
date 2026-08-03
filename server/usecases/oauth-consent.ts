import { isAuthorizationScope } from '@shared/authorization'
import { OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_REFRESH_TOKEN_SECONDS, OAUTH_STANDARD_SCOPES } from '@shared/oauth'
import {
  type OAuthConsentContext,
  type OAuthGrantScope,
  oauthGrantScopeSchema,
  parseWorkspaceAuthorizationDetails,
} from '@shared/schemas'
import type { Database } from '../platform/interface'
import type { Deps } from './deps'
import { badRequest, forbidden } from './ports'

export async function getOAuthConsentContext(
  deps: Pick<Deps, 'oauth' | 'org'>,
  input: { db: Database; userId: string; oauthQuery: string },
): Promise<OAuthConsentContext> {
  const params = new URLSearchParams(input.oauthQuery)
  const clientId = params.get('client_id')
  const redirectUri = params.get('redirect_uri')
  const responseType = params.get('response_type')
  const scopeValue = params.get('scope') ?? ''
  const authorizationDetailsValue = params.get('authorization_details')

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
  const scopes = requestedScopes.filter(isOAuthGrantScope)
  if (
    scopes.length === 0 ||
    requestedScopes.length !== standardScopes.length + scopes.length ||
    requestedScopes.some((scope) => !client.scopes.includes(scope))
  ) {
    throw badRequest('Invalid OAuth scope')
  }

  let authorizationDetails: ReturnType<typeof parseWorkspaceAuthorizationDetails>
  try {
    authorizationDetails = parseWorkspaceAuthorizationDetails(authorizationDetailsValue)
  } catch {
    throw badRequest('Invalid OAuth authorization details')
  }
  if (authorizationDetails.length === 0) throw badRequest('At least one workspace authorization request is required')
  const requestedWorkspaceIds = authorizationDetails.flatMap((detail) => (detail.identifier ? [detail.identifier] : []))
  const requestedWorkspaceIdSet = new Set(requestedWorkspaceIds)
  const availableWorkspaces = await deps.org.listUserOrgs(input.userId)
  const workspaces =
    requestedWorkspaceIds.length > 0
      ? availableWorkspaces.filter((workspace) => requestedWorkspaceIdSet.has(workspace.id))
      : availableWorkspaces
  if (
    workspaces.length === 0 ||
    (requestedWorkspaceIds.length > 0 && workspaces.length !== requestedWorkspaceIdSet.size)
  ) {
    throw forbidden('Workspace access is required for OAuth')
  }

  return {
    clientId,
    clientName: client.clientName,
    clientOrigin: new URL(redirectUri).origin,
    workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
    requestedWorkspaceIds,
    scopes,
    standardScopes,
    redirectUri,
    grantLifetime: {
      accessTokenSeconds: OAUTH_ACCESS_TOKEN_SECONDS,
      refreshTokenSeconds: OAUTH_REFRESH_TOKEN_SECONDS,
    },
  }
}

function isOAuthGrantScope(scope: string): scope is OAuthGrantScope {
  return isAuthorizationScope(scope) && oauthGrantScopeSchema.safeParse(scope).success
}
