import {
  consumeClientAssertion,
  type OAuthProviderExtension,
  type oauthProvider,
  type SchemaClient,
  type Scope,
} from '@better-auth/oauth-provider'
import { APIError, type User } from 'better-auth'
import { createLocalJWKSet, createRemoteJWKSet, type JSONWebKeySet, jwtVerify } from 'jose'
import { isAuthorizationScope } from '../../shared/authorization'
import {
  AGENT_ACTOR_RESOURCE,
  JWT_BEARER_GRANT_TYPE,
  OAUTH_ACCESS_TOKEN_SECONDS,
  OAUTH_ACCESS_TOKEN_TYPE,
  OAUTH_ACTOR_TOKEN_SECONDS,
  OAUTH_REFRESH_TOKEN_SECONDS,
  OAUTH_SCOPES,
  OAUTH_STANDARD_SCOPES,
  TOKEN_EXCHANGE_GRANT_TYPE,
} from '../../shared/oauth'
import { createOrgRepo } from '../adapters/repos/org'
import type { Database } from '../platform/interface'

type OAuthOrgLookup = Pick<ReturnType<typeof createOrgRepo>, 'findPersonalOrg' | 'getMemberRole'>
type OAuthProviderOptions = Parameters<typeof oauthProvider>[0]

export function createOAuthProviderOptions(input: {
  db: Database
  resourceAudience?: string
  orgs?: OAuthOrgLookup
}): OAuthProviderOptions {
  const orgs = input.orgs ?? createOrgRepo(input.db)
  const resources = input.resourceAudience
    ? [
        {
          identifier: input.resourceAudience,
          name: 'ZPan API',
          accessTokenTtl: OAUTH_ACCESS_TOKEN_SECONDS,
          allowedScopes: [...OAUTH_SCOPES],
        },
        {
          identifier: AGENT_ACTOR_RESOURCE,
          name: 'ZPan Agent Actor',
          accessTokenTtl: OAUTH_ACTOR_TOKEN_SECONDS,
          allowedScopes: ['openid'],
        },
      ]
    : undefined

  return {
    loginPage: '/sign-in',
    consentPage: '/settings/oauth-apps',
    accessTokenExpiresIn: OAUTH_ACCESS_TOKEN_SECONDS,
    m2mAccessTokenExpiresIn: OAUTH_ACTOR_TOKEN_SECONDS,
    refreshTokenExpiresIn: OAUTH_REFRESH_TOKEN_SECONDS,
    grantTypes: ['authorization_code', 'refresh_token'],
    scopes: [...OAUTH_SCOPES],
    resources,
    enforcePerClientResources: false,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationRequirePKCE: true,
    clientRegistrationAllowedScopes: [...OAUTH_SCOPES],
    clientRegistrationDefaultScopes: [...OAUTH_STANDARD_SCOPES],
    extensions: input.resourceAudience ? [externalResourceGrantExtension(input.resourceAudience)] : [],
    advertisedMetadata: { scopes_supported: [...OAUTH_SCOPES] },
    silenceWarnings: {
      oauthAuthServerConfig: true,
      openidConfig: true,
    },
    postLogin: {
      page: '/settings/oauth-apps',
      shouldRedirect: async () => false,
      consentReferenceId: async ({ user, session, scopes }) => {
        const clientScopes = scopes.filter((scope) => scope !== 'openid' && scope !== 'profile' && scope !== 'email')
        const grantableScopes = new Set<string>(OAUTH_SCOPES)
        if (clientScopes.some((scope) => !grantableScopes.has(scope))) {
          throw oauthError('invalid_scope', 'Scope is not grantable')
        }
        const orgId = typeof session.activeOrganizationId === 'string' ? session.activeOrganizationId : null
        const selectedOrgId = orgId || (await orgs.findPersonalOrg(user.id))
        if (!selectedOrgId) throw oauthError('invalid_request', 'A workspace is required for OAuth')
        const role = await orgs.getMemberRole(selectedOrgId, user.id)
        if (!role && selectedOrgId !== (await orgs.findPersonalOrg(user.id))) {
          throw new APIError('FORBIDDEN', {
            error: 'access_denied',
            error_description: 'Workspace access is required for OAuth',
          })
        }
        return selectedOrgId
      },
    },
    customAccessTokenClaims: async ({ user, referenceId }) => {
      if (!user?.id || !referenceId) return {}
      return {
        zpan_org_id: referenceId,
        zpan_actor: 'oauth',
      }
    },
  }
}

function externalResourceGrantExtension(resourceAudience: string): OAuthProviderExtension {
  return {
    grants: {
      [JWT_BEARER_GRANT_TYPE]: async ({ ctx, opts, provider }) => {
        const { client } = await provider.authenticateClient()
        const assertion = bodyString(ctx.body, 'assertion')
        const payload = await verifyAgentAssertion(ctx, opts, client, assertion)
        const subject = requiredClaim(payload.sub, 'assertion sub')
        const issuer = requiredClaim(payload.iss, 'assertion iss')

        return provider.issueTokens({
          client,
          scopes: ['openid'],
          user: assertionUser(subject),
          resources: [AGENT_ACTOR_RESOURCE],
          accessTokenClaims: {
            zpan_actor_token: true,
            zpan_actor_issuer: issuer,
          },
        })
      },
      [TOKEN_EXCHANGE_GRANT_TYPE]: async ({ ctx, provider }) => {
        if (!ctx.headers?.get('dpop')) throw oauthError('invalid_dpop_proof', 'DPoP proof header is required')
        const requestedScopes = uniqueScopes(bodyString(ctx.body, 'scope'))
        if (requestedScopes.length === 0 || requestedScopes.some((scope) => !isAuthorizationScope(scope))) {
          throw oauthError('invalid_scope', 'Token exchange requires ZPan API scopes')
        }
        requireTokenType(ctx.body, 'subject_token_type')
        requireTokenType(ctx.body, 'actor_token_type')
        requireTokenType(ctx.body, 'requested_token_type')
        const resource = bodyString(ctx.body, 'resource')
        if (resource !== resourceAudience) throw oauthError('invalid_target', 'Unsupported token exchange resource')

        const { client } = await provider.authenticateClient({ scopes: requestedScopes })
        const subject = await provider.requireActiveAccessToken(bodyString(ctx.body, 'subject_token'), client.clientId)
        const actor = await provider.requireActiveAccessToken(bodyString(ctx.body, 'actor_token'), client.clientId)
        if (actor.zpan_actor_token !== true || typeof actor.sub !== 'string') {
          throw oauthError('invalid_grant', 'Actor token is invalid')
        }
        const subjectScopes = uniqueScopes(typeof subject.scope === 'string' ? subject.scope : '')
        if (requestedScopes.some((scope) => !subjectScopes.includes(scope))) {
          throw oauthError('invalid_scope', 'Requested scope exceeds the connected account grant')
        }
        if (typeof subject.sub !== 'string') throw oauthError('invalid_grant', 'Subject token has no user')
        const orgId = typeof subject.zpan_org_id === 'string' ? subject.zpan_org_id : undefined
        if (!orgId) throw oauthError('invalid_grant', 'Subject token has no workspace')
        const user = await ctx.context.internalAdapter.findUserById(subject.sub)
        if (!user) throw oauthError('invalid_grant', 'Subject user no longer exists')

        return provider.issueTokens({
          client,
          scopes: requestedScopes,
          user,
          referenceId: orgId,
          resources: [resourceAudience],
          accessTokenClaims: {
            act: {
              sub: actor.sub,
              ...(typeof actor.zpan_actor_issuer === 'string' ? { iss: actor.zpan_actor_issuer } : {}),
            },
          },
          tokenResponse: { issued_token_type: OAUTH_ACCESS_TOKEN_TYPE },
        })
      },
    },
  }
}

async function verifyAgentAssertion(
  ctx: Parameters<NonNullable<OAuthProviderExtension['grants']>[string]>[0]['ctx'],
  opts: Parameters<NonNullable<OAuthProviderExtension['grants']>[string]>[0]['opts'],
  client: SchemaClient<Scope[]>,
  assertion: string,
) {
  const jwks = client.jwks
    ? createLocalJWKSet(JSON.parse(client.jwks) as JSONWebKeySet)
    : client.jwksUri
      ? createRemoteJWKSet(new URL(client.jwksUri))
      : null
  if (!jwks) throw oauthError('invalid_client', 'Registered client has no JWKS')
  const endpoint = ctx.request?.url ?? `${ctx.context.baseURL}${ctx.path ?? '/oauth2/token'}`
  let verified: Awaited<ReturnType<typeof jwtVerify>>
  try {
    verified = await jwtVerify(assertion, jwks, { audience: endpoint, maxTokenAge: '5m' })
  } catch {
    throw oauthError('invalid_grant', 'Agent assertion is invalid')
  }
  const issuer = requiredClaim(verified.payload.iss, 'assertion iss')
  if (client.jwksUri) {
    let issuerOrigin: string
    try {
      issuerOrigin = new URL(issuer).origin
    } catch {
      throw oauthError('invalid_grant', 'Agent assertion issuer must be an absolute URL')
    }
    if (issuerOrigin !== new URL(client.jwksUri).origin) {
      throw oauthError('invalid_grant', 'Agent assertion issuer does not match the registered client')
    }
  }
  await consumeClientAssertion(ctx, opts, {
    namespace: `${JWT_BEARER_GRANT_TYPE}:${client.clientId}`,
    payload: verified.payload,
    expectedAudience: endpoint,
  })
  return verified.payload
}

function assertionUser(subject: string): User {
  const now = new Date()
  return {
    id: subject,
    name: subject,
    email: `${encodeURIComponent(subject)}@agent.invalid`,
    emailVerified: false,
    image: null,
    createdAt: now,
    updatedAt: now,
  }
}

function bodyString(body: unknown, field: string): string {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>)[field] : undefined
  if (typeof value !== 'string' || !value) throw oauthError('invalid_request', `${field} is required`)
  return value
}

function requireTokenType(body: unknown, field: string) {
  if (bodyString(body, field) !== OAUTH_ACCESS_TOKEN_TYPE) {
    throw oauthError('invalid_request', `${field} must be ${OAUTH_ACCESS_TOKEN_TYPE}`)
  }
}

function uniqueScopes(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))]
}

function requiredClaim(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw oauthError('invalid_grant', `${name} is required`)
  return value
}

function oauthError(error: string, errorDescription: string): APIError {
  return new APIError('BAD_REQUEST', { error, error_description: errorDescription })
}
