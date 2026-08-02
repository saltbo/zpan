import {
  type AuthorizationDetail,
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
  WORKSPACE_AUTHORIZATION_DETAIL_TYPE,
} from '../../shared/oauth'
import { workspaceAuthorizationDetailSchema } from '../../shared/schemas'
import { createOrgRepo } from '../adapters/repos/org'
import type { Database } from '../platform/interface'
import { resolvePushedAuthorizationRequest } from './oauth-par'

type OAuthOrgLookup = Pick<ReturnType<typeof createOrgRepo>, 'canReadOrg'>
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
    consentPage: '/oauth/consent',
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
    extensions: [
      oauthStandardsMetadataExtension(),
      ...(input.resourceAudience ? [externalResourceGrantExtension(input.resourceAudience)] : []),
    ],
    advertisedMetadata: { scopes_supported: [...OAUTH_SCOPES] },
    authorizationDetails: {
      typesSupported: [WORKSPACE_AUTHORIZATION_DETAIL_TYPE],
      validate: async ({ details, phase, requested, user }) => {
        const workspaces = details.map(parseWorkspaceAuthorizationDetail)
        if (phase === 'request') {
          if (workspaces.length === 0)
            throw oauthError('invalid_authorization_details', 'At least one workspace request is required')
          assertUniqueWorkspaceIdentifiers(workspaces)
          return workspaces
        }
        if (phase === 'consent') {
          if (!user?.id) throw oauthError('access_denied', 'Authentication is required')
          const original = (requested ?? []).map(parseWorkspaceAuthorizationDetail)
          if (original.length === 0 || workspaces.length === 0) {
            throw oauthError('invalid_authorization_details', 'At least one workspace is required')
          }
          assertUniqueWorkspaceIdentifiers(workspaces)
          const fixedWorkspaceIds = new Set(
            original.flatMap((detail) => (detail.identifier ? [detail.identifier] : [])),
          )
          if (
            fixedWorkspaceIds.size > 0 &&
            workspaces.some((detail) => !detail.identifier || !fixedWorkspaceIds.has(detail.identifier))
          ) {
            throw oauthError('access_denied', 'Workspace selection exceeds the authorization request')
          }
          for (const detail of workspaces) {
            if (!detail.identifier || !(await orgs.canReadOrg(user.id, detail.identifier))) {
              throw oauthError('access_denied', 'Workspace access is required')
            }
          }
          return workspaces
        }
        assertUniqueWorkspaceIdentifiers(workspaces)
        return workspaces
      },
      isSubset: ({ requested, granted }) => workspaceAuthorizationDetailsCovered(requested, granted),
      resolve: ({ requested, granted }) =>
        requested.every((detail) => parseWorkspaceAuthorizationDetail(detail).identifier) ? requested : granted,
    },
    requestUriResolver: resolvePushedAuthorizationRequest,
    silenceWarnings: {
      oauthAuthServerConfig: true,
      openidConfig: true,
    },
    customAccessTokenClaims: async ({ user }) => (user?.id ? { zpan_actor: 'oauth' } : {}),
  }
}

function oauthStandardsMetadataExtension(): OAuthProviderExtension {
  return {
    metadata: ({ ctx }) => ({
      pushed_authorization_request_endpoint: `${ctx.context.baseURL}/oauth2/par`,
      require_pushed_authorization_requests: false,
    }),
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
        const authorizationDetails = parseTokenExchangeAuthorizationDetails(ctx.body)
        const subjectAuthorizationDetails = Array.isArray(subject.authorization_details)
          ? (subject.authorization_details as AuthorizationDetail[])
          : []
        if (!workspaceAuthorizationDetailsCovered(authorizationDetails, subjectAuthorizationDetails)) {
          throw oauthError('invalid_authorization_details', 'Requested workspace is not authorized')
        }
        const orgId = parseWorkspaceAuthorizationDetail(authorizationDetails[0]).identifier
        if (!orgId) throw oauthError('invalid_authorization_details', 'Token exchange requires one workspace')
        const user = await ctx.context.internalAdapter.findUserById(subject.sub)
        if (!user) throw oauthError('invalid_grant', 'Subject user no longer exists')

        return provider.issueTokens({
          client,
          scopes: requestedScopes,
          user,
          authorizationDetails,
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

function parseWorkspaceAuthorizationDetail(detail: AuthorizationDetail) {
  const parsed = workspaceAuthorizationDetailSchema.safeParse(detail)
  if (!parsed.success) throw oauthError('invalid_authorization_details', 'Invalid workspace authorization detail')
  return parsed.data
}

function assertUniqueWorkspaceIdentifiers(details: Array<{ identifier?: string }>) {
  const identifiers = details.flatMap((detail) => (detail.identifier ? [detail.identifier] : []))
  if (new Set(identifiers).size !== identifiers.length) {
    throw oauthError('invalid_authorization_details', 'Workspace authorization details must be unique')
  }
}

function workspaceAuthorizationDetailsCovered(
  requested: AuthorizationDetail[],
  granted: AuthorizationDetail[],
): boolean {
  const grantedIds = new Set(
    granted.map(parseWorkspaceAuthorizationDetail).flatMap((detail) => (detail.identifier ? [detail.identifier] : [])),
  )
  return requested
    .map(parseWorkspaceAuthorizationDetail)
    .every((detail) => (detail.identifier ? grantedIds.has(detail.identifier) : grantedIds.size > 0))
}

function parseTokenExchangeAuthorizationDetails(body: unknown): AuthorizationDetail[] {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>).authorization_details : undefined
  if (typeof raw !== 'string') throw oauthError('invalid_authorization_details', 'authorization_details is required')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw oauthError('invalid_authorization_details', 'authorization_details must be valid JSON')
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw oauthError('invalid_authorization_details', 'Token exchange requires exactly one workspace')
  }
  return parsed.map((detail) => parseWorkspaceAuthorizationDetail(detail as AuthorizationDetail))
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
  } catch (error) {
    console.warn('Agent assertion verification failed', {
      code: error instanceof Error && 'code' in error ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
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
