import { z } from 'zod'
import { generateToken } from '../../shared/ids'
import {
  JWT_BEARER_GRANT_TYPE,
  OAUTH_SCOPES,
  TOKEN_EXCHANGE_GRANT_TYPE,
  WORKSPACE_AUTHORIZATION_DETAIL_TYPE,
} from '../../shared/oauth'
import {
  deleteManagedOAuthClient,
  findManagedOAuthClient,
  getManagedOAuthClient,
  insertOAuthClientRegistration,
  isOAuthResourceAvailable,
  listManagedOAuthClientResources,
  type ManagedOAuthClient,
  replaceManagedOAuthClient,
} from '../adapters/repos/oauth-client-registration'
import type { Database } from '../platform/interface'

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
}
const CLIENT_CONFIGURATION_PREFIX = '/api/auth/oauth2/register/'
const SUPPORTED_GRANTS = new Set([
  'authorization_code',
  'refresh_token',
  JWT_BEARER_GRANT_TYPE,
  TOKEN_EXCHANGE_GRANT_TYPE,
])
const FORBIDDEN_UPDATE_FIELDS = [
  'registration_access_token',
  'registration_client_uri',
  'client_secret_expires_at',
  'client_id_issued_at',
] as const
const KNOWN_METADATA_FIELDS = new Set([
  'client_id',
  'client_secret',
  'redirect_uris',
  'scope',
  'client_name',
  'client_uri',
  'logo_uri',
  'contacts',
  'tos_uri',
  'policy_uri',
  'software_id',
  'software_version',
  'software_statement',
  'post_logout_redirect_uris',
  'backchannel_logout_uri',
  'backchannel_logout_session_required',
  'token_endpoint_auth_method',
  'jwks',
  'jwks_uri',
  'grant_types',
  'response_types',
  'type',
  'subject_type',
  'dpop_bound_access_tokens',
  'resources',
  'require_pkce',
])

const absoluteUrl = z.string().url()
const updateSchema = z
  .object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1).optional(),
    redirect_uris: z.array(absoluteUrl).default([]),
    scope: z.string().optional(),
    client_name: z.string().optional(),
    client_uri: absoluteUrl.optional(),
    logo_uri: absoluteUrl.optional(),
    contacts: z.array(z.string().min(1)).optional(),
    tos_uri: absoluteUrl.optional(),
    policy_uri: absoluteUrl.optional(),
    software_id: z.string().optional(),
    software_version: z.string().optional(),
    software_statement: z.string().optional(),
    post_logout_redirect_uris: z.array(absoluteUrl).optional(),
    backchannel_logout_uri: absoluteUrl.optional(),
    backchannel_logout_session_required: z.boolean().optional(),
    token_endpoint_auth_method: z.string().min(1).default('client_secret_basic'),
    jwks: z
      .union([
        z.array(z.record(z.string(), z.unknown())),
        z.object({ keys: z.array(z.record(z.string(), z.unknown())) }),
      ])
      .optional(),
    jwks_uri: absoluteUrl.optional(),
    grant_types: z.array(z.string().min(1)).default(['authorization_code']),
    response_types: z.array(z.literal('code')).optional(),
    type: z.enum(['web', 'native', 'user-agent-based']).optional(),
    subject_type: z.enum(['public', 'pairwise']).optional(),
    dpop_bound_access_tokens: z.boolean().optional(),
    authorization_details_types: z.array(z.string().min(1)).optional(),
    resources: z.array(absoluteUrl).optional(),
    require_pkce: z.boolean().optional(),
  })
  .passthrough()

export function addOAuthClientRegistrationManagementOpenApi(document: { paths: Record<string, unknown> }): void {
  const registration = document.paths['/api/auth/oauth2/register'] as
    | { post?: { responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> } }
    | undefined
  const registrationSchema = registration?.post?.responses?.['201']?.content?.['application/json']?.schema
  if (registrationSchema) {
    const properties = (registrationSchema.properties ?? {}) as Record<string, unknown>
    registrationSchema.properties = {
      ...properties,
      registration_client_uri: { type: 'string', format: 'uri' },
      registration_access_token: { type: 'string', pattern: '^[A-Za-z0-9]{43}$' },
    }
    registrationSchema.required = [
      ...new Set([
        ...(Array.isArray(registrationSchema.required) ? registrationSchema.required : []),
        'registration_client_uri',
        'registration_access_token',
      ]),
    ]
  }

  const clientInformationSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      client_id: { type: 'string' },
      registration_client_uri: { type: 'string', format: 'uri' },
      registration_access_token: { type: 'string', pattern: '^[A-Za-z0-9]{43}$' },
      scope: { type: 'string' },
    },
    required: ['client_id', 'registration_client_uri', 'registration_access_token'],
  }
  const bearerSecurity = [{ bearerAuth: [] }]
  document.paths['/api/auth/oauth2/register/{clientId}'] = {
    parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'string' } }],
    get: {
      operationId: 'getDynamicOAuthClientRegistration',
      summary: 'Read a dynamic OAuth client registration',
      security: bearerSecurity,
      responses: {
        '200': {
          description: 'Current client registration',
          content: { 'application/json': { schema: clientInformationSchema } },
        },
      },
    },
    put: {
      operationId: 'updateDynamicOAuthClientRegistration',
      summary: 'Replace a dynamic OAuth client registration',
      security: bearerSecurity,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { type: 'object', additionalProperties: true, required: ['client_id'] } },
        },
      },
      responses: {
        '200': {
          description: 'Updated client registration',
          content: { 'application/json': { schema: clientInformationSchema } },
        },
      },
    },
    delete: {
      operationId: 'deleteDynamicOAuthClientRegistration',
      summary: 'Delete a dynamic OAuth client registration',
      security: bearerSecurity,
      responses: { '204': { description: 'Client registration deleted' } },
    },
  }
}

export async function handleOAuthClientRegistrationManagement(
  request: Request,
  db: Database,
  next: (request: Request) => Promise<Response>,
  registrationBaseUrl?: string,
): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/api/auth/oauth2/register' && request.method === 'POST') {
    return augmentRegistrationResponse(request, db, next, registrationBaseUrl)
  }
  if (!url.pathname.startsWith(CLIENT_CONFIGURATION_PREFIX)) return next(request)

  const encodedClientId = url.pathname.slice(CLIENT_CONFIGURATION_PREFIX.length)
  if (!encodedClientId || encodedClientId.includes('/')) return next(request)
  let clientId: string
  try {
    clientId = decodeURIComponent(encodedClientId)
  } catch {
    return oauthJson(400, { error: 'invalid_request', error_description: 'Client identifier is malformed' })
  }
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
    return oauthJson(
      405,
      { error: 'invalid_request', error_description: 'Method not allowed' },
      { Allow: 'GET, PUT, DELETE' },
    )
  }

  const authorization = request.headers.get('Authorization')
  const token = bearerToken(authorization)
  if (!token) {
    return authorization
      ? bearerError(400, 'invalid_request', 'The registration access token is malformed')
      : bearerError(401, 'invalid_token', 'A registration access token is required')
  }
  const tokenHash = await hashToken(token)
  const client = await findManagedOAuthClient(db, clientId, tokenHash)
  if (!client) return bearerError(401, 'invalid_token', 'The registration access token is invalid')
  const clientConfigurationUrl = configurationUrl(clientId, registrationBaseUrl ?? request.url)

  if (request.method === 'GET')
    return oauthJson(200, await clientInformation(db, client, clientConfigurationUrl, token))
  if (request.method === 'DELETE') {
    await deleteManagedOAuthClient(db, clientId)
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS })
  }
  return updateClient(request, db, client, clientConfigurationUrl, token)
}

async function augmentRegistrationResponse(
  request: Request,
  db: Database,
  next: (request: Request) => Promise<Response>,
  registrationBaseUrl?: string,
): Promise<Response> {
  const response = await next(request)
  if (response.status !== 201) return response
  const body = (await response.clone().json()) as Record<string, unknown>
  const clientId = typeof body.client_id === 'string' ? body.client_id : null
  if (!clientId) return response

  const token = registrationToken()
  try {
    await insertOAuthClientRegistration(db, clientId, await hashToken(token))
  } catch (error) {
    await deleteManagedOAuthClient(db, clientId)
    throw error
  }
  body.registration_client_uri = configurationUrl(clientId, registrationBaseUrl ?? request.url).href
  body.registration_access_token = token
  return Response.json(body, {
    status: 201,
    headers: mergedHeaders(response.headers, NO_STORE_HEADERS),
  })
}

async function updateClient(
  request: Request,
  db: Database,
  current: ManagedOAuthClient,
  url: URL,
  registrationToken: string,
): Promise<Response> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return oauthJson(415, { error: 'invalid_request', error_description: 'Content-Type must be application/json' })
  }
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return oauthJson(400, { error: 'invalid_request', error_description: 'Request body must be valid JSON' })
  }
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  if (!raw) return invalidClientMetadata('Request body must be a JSON object')
  const forbidden = FORBIDDEN_UPDATE_FIELDS.find((field) => field in raw)
  if (forbidden) return invalidClientMetadata(`${forbidden} must not be included in an update request`)

  const parsed = updateSchema.safeParse(raw)
  if (!parsed.success) return invalidClientMetadata(parsed.error.issues[0]?.message ?? 'Invalid client metadata')
  const metadata = parsed.data
  if (metadata.client_id !== current.clientId)
    return invalidClientMetadata('client_id must match the registered client')
  if (metadata.client_secret && !(await matchesStoredClientSecret(metadata.client_secret, current.clientSecret))) {
    return invalidClientMetadata('client_secret must match the currently issued client secret')
  }
  if (metadata.token_endpoint_auth_method !== current.tokenEndpointAuthMethod) {
    return invalidClientMetadata('token_endpoint_auth_method cannot be changed without rotating client credentials')
  }
  const validationError = validateMetadata(metadata, url)
  if (validationError) return invalidClientMetadata(validationError)
  for (const resourceId of metadata.resources ?? []) {
    if (!(await isOAuthResourceAvailable(db, resourceId))) {
      return oauthJson(400, {
        error: 'invalid_target',
        error_description: `requested resource ${resourceId} is unavailable`,
      })
    }
  }

  const extensionMetadata = Object.fromEntries(
    Object.entries(raw).filter(
      ([key]) => !KNOWN_METADATA_FIELDS.has(key) && !FORBIDDEN_UPDATE_FIELDS.includes(key as never),
    ),
  )
  await replaceManagedOAuthClient(
    db,
    current.clientId,
    {
      scopes: json(metadata.scope ? uniqueWords(metadata.scope) : undefined),
      name: metadata.client_name ?? null,
      uri: metadata.client_uri ?? null,
      icon: metadata.logo_uri ?? null,
      contacts: json(metadata.contacts),
      tos: metadata.tos_uri ?? null,
      policy: metadata.policy_uri ?? null,
      softwareId: metadata.software_id ?? null,
      softwareVersion: metadata.software_version ?? null,
      softwareStatement: metadata.software_statement ?? null,
      redirectUris: JSON.stringify(metadata.redirect_uris),
      postLogoutRedirectUris: json(metadata.post_logout_redirect_uris),
      backchannelLogoutUri: metadata.backchannel_logout_uri ?? null,
      backchannelLogoutSessionRequired: metadata.backchannel_logout_session_required ?? null,
      jwks: metadata.jwks ? JSON.stringify(normalizeJwks(metadata.jwks)) : null,
      jwksUri: metadata.jwks_uri ?? null,
      grantTypes: JSON.stringify(metadata.grant_types),
      responseTypes: json(metadata.response_types),
      type: metadata.type ?? null,
      requirePKCE: metadata.require_pkce ?? null,
      dpopBoundAccessTokens: metadata.dpop_bound_access_tokens ?? false,
      subjectType: metadata.subject_type ?? null,
      metadata: Object.keys(extensionMetadata).length > 0 ? JSON.stringify(extensionMetadata) : null,
      updatedAt: new Date(),
    },
    metadata.resources ?? [],
  )

  const updated = await getManagedOAuthClient(db, current.clientId)
  if (!updated) return bearerError(401, 'invalid_token', 'The registered client no longer exists')
  return oauthJson(200, await clientInformation(db, updated, url, registrationToken))
}

function validateMetadata(metadata: z.infer<typeof updateSchema>, serverUrl: URL): string | null {
  if (metadata.grant_types.some((grant) => !SUPPORTED_GRANTS.has(grant)))
    return 'grant_types contains an unsupported grant type'
  if (metadata.grant_types.includes('authorization_code')) {
    if (metadata.redirect_uris.length === 0) return 'redirect_uris is required for authorization_code clients'
    if (!metadata.response_types?.includes('code'))
      return 'response_types must include code for authorization_code clients'
  } else if (metadata.response_types?.includes('code')) {
    return 'response_types cannot include code without the authorization_code grant'
  }
  if (uniqueWords(metadata.scope ?? '').some((scope) => !(OAUTH_SCOPES as readonly string[]).includes(scope))) {
    return 'scope contains an unsupported scope'
  }
  if (metadata.authorization_details_types?.some((type) => type !== WORKSPACE_AUTHORIZATION_DETAIL_TYPE)) {
    return 'authorization_details_types contains an unsupported type'
  }
  if (metadata.jwks && metadata.jwks_uri) return 'jwks and jwks_uri are mutually exclusive'
  if (metadata.jwks_uri && !isSecureOrLocalDevelopmentUrl(metadata.jwks_uri, serverUrl)) {
    return 'jwks_uri must use HTTPS'
  }
  return null
}

function isSecureOrLocalDevelopmentUrl(value: string, serverUrl: URL): boolean {
  const url = new URL(value)
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return isLoopbackHostname(serverUrl.hostname) && isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname.startsWith('127.')
  )
}

async function clientInformation(
  db: Database,
  client: ManagedOAuthClient,
  requestUrl: URL,
  registrationToken: string,
): Promise<Record<string, unknown>> {
  const extensionMetadata = parseObject(client.metadata)
  const resources = await listManagedOAuthClientResources(db, client.clientId)
  return compact({
    ...extensionMetadata,
    registration_access_token: registrationToken,
    registration_client_uri: requestUrl.href,
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    scope: parseArray(client.scopes)?.join(' '),
    client_name: client.name,
    client_uri: client.uri,
    logo_uri: client.icon,
    contacts: parseArray(client.contacts),
    tos_uri: client.tos,
    policy_uri: client.policy,
    software_id: client.softwareId,
    software_version: client.softwareVersion,
    software_statement: client.softwareStatement,
    redirect_uris: parseArray(client.redirectUris) ?? [],
    post_logout_redirect_uris: parseArray(client.postLogoutRedirectUris),
    backchannel_logout_uri: client.backchannelLogoutUri,
    backchannel_logout_session_required: client.backchannelLogoutSessionRequired,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    jwks: client.jwks ? JSON.parse(client.jwks) : undefined,
    jwks_uri: client.jwksUri,
    grant_types: parseArray(client.grantTypes),
    response_types: parseArray(client.responseTypes),
    type: client.type,
    require_pkce: client.requirePKCE,
    dpop_bound_access_tokens: client.dpopBoundAccessTokens,
    subject_type: client.subjectType,
    resources: resources.length > 0 ? resources : undefined,
  })
}

function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header)
  return match?.[1] ?? null
}

function bearerError(status: number, error: string, description: string): Response {
  return oauthJson(status, { error, error_description: description }, { 'WWW-Authenticate': `Bearer error="${error}"` })
}

function invalidClientMetadata(description: string): Response {
  return oauthJson(400, { error: 'invalid_client_metadata', error_description: description })
}

function oauthJson(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: mergedHeaders(headers, NO_STORE_HEADERS) })
}

function mergedHeaders(...inputs: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers()
  for (const input of inputs) {
    if (input)
      new Headers(input).forEach((value, key) => {
        headers.set(key, value)
      })
  }
  return headers
}

function registrationToken(): string {
  return generateToken(43)
}

function configurationUrl(clientId: string, baseUrl: string): URL {
  const endpoint = new URL(CLIENT_CONFIGURATION_PREFIX, baseUrl).href
  return new URL(encodeURIComponent(clientId), endpoint)
}

async function hashToken(token: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
}

async function matchesStoredClientSecret(candidate: string, stored: string | null): Promise<boolean> {
  return Boolean(stored) && (await hashToken(candidate)) === stored
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function uniqueWords(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))]
}

function json(value: unknown[] | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function parseArray(value: string | null): string[] | undefined {
  return value ? (JSON.parse(value) as string[]) : undefined
}

function parseObject(value: string | null): Record<string, unknown> {
  return value ? (JSON.parse(value) as Record<string, unknown>) : {}
}

function normalizeJwks(value: Array<Record<string, unknown>> | { keys: Array<Record<string, unknown>> }) {
  return Array.isArray(value) ? { keys: value } : value
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null))
}
