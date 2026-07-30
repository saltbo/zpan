import { createRoute, type RouteConfig, type z } from '@hono/zod-openapi'
import { AGENT_GRANTABLE_API_KEY_SCOPES } from '@shared/api-key-templates'
import { errorResponseSchema } from '@shared/schemas'
import { authorize, type RouteAuthorizationDeclaration, type ScopedAuthorizationPolicy } from '../middleware/authz'

// Shared OpenAPI route helpers used by every resource router. Generic over the
// schema so its precise type reaches `createRoute`: that types `c.req.valid(...)`
// on the request side and strictly checks the handler's `c.json(...)` on the
// response side. A widened `z.ZodType` would erase both — and silently disable
// response checking, which is how schemas drift from what handlers actually
// return.

export const jsonContent = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { 'application/json': { schema } },
  description,
})

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  body: { content: { 'application/json': { schema } }, required: true },
})

// A route response carrying the shared AIP-193 `Error` envelope. Handlers and
// usecases produce errors as `AppError` values that `app.onError` renders via
// `jsonError`; this just documents the response shape in the OpenAPI document.
export const errorResponse = (description: string) => jsonContent(errorResponseSchema, description)

const AGENT_GRANTABLE_SCOPE_SET = new Set<string>(AGENT_GRANTABLE_API_KEY_SCOPES)

export function authRoute<P extends string, T extends Omit<RouteConfig, 'path'> & { path: P }>(
  auth: RouteAuthorizationDeclaration,
  config: T,
): T & { getRoutingPath(): string } {
  const middleware = [authorize(auth), ...((config.middleware ?? []) as [])]
  return createRoute({
    ...config,
    middleware,
    security: openApiSecurity(auth),
    'x-zpan-auth': openApiAuthMetadata(auth),
    ...openApiCliMetadata(auth),
  } as T) as T & { getRoutingPath(): string }
}

export function findOperationsMissingAuthContract(paths: Record<string, Record<string, unknown>>): string[] {
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options'])
  const missing: string[] = []
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue
      if (!operation || typeof operation !== 'object') continue
      if (hasValidAuthContract(operation)) continue
      missing.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return missing
}

function hasValidAuthContract(operation: object): boolean {
  if (!('x-zpan-auth' in operation)) return false
  const auth = operation['x-zpan-auth']
  if (!auth || typeof auth !== 'object' || !('public' in auth) || !('scopes' in auth)) return false
  if (typeof auth.public !== 'boolean' || !Array.isArray(auth.scopes)) return false
  return auth.public ? auth.scopes.length === 0 : auth.scopes.length > 0
}

function openApiSecurity(auth: RouteAuthorizationDeclaration): Record<string, string[]>[] {
  if ('public' in auth) return []
  return openApiPolicySecurity(auth)
}

function openApiCliMetadata(auth: RouteAuthorizationDeclaration): Record<string, boolean> {
  if ('public' in auth) return {}
  return isAgentCallablePolicy(auth) ? {} : { 'x-mcp-ignore': true }
}

function openApiAuthMetadata(auth: RouteAuthorizationDeclaration): Record<string, unknown> {
  if ('public' in auth) return { public: true, scopes: [] }
  return {
    public: false,
    ...openApiPolicyMetadata(auth),
  }
}

function openApiPolicySecurity(policy: ScopedAuthorizationPolicy): Record<string, string[]>[] {
  return policy.scopes.every((scope) => AGENT_GRANTABLE_SCOPE_SET.has(scope))
    ? [{ agentOAuth2: [...policy.scopes] }, { agentApiKey: [...policy.scopes] }, { cookieAuth: [] }]
    : [{ bearerAuth: [...policy.scopes] }, { cookieAuth: [] }]
}

function isAgentCallablePolicy(policy: ScopedAuthorizationPolicy): boolean {
  return policy.scopes.every((scope) => AGENT_GRANTABLE_SCOPE_SET.has(scope))
}

function openApiPolicyMetadata(policy: ScopedAuthorizationPolicy): Record<string, unknown> {
  return {
    scopes: [...policy.scopes],
    minTeamRole: policy.minTeamRole ?? null,
    siteRole: policy.siteRole ?? null,
    auditDenied: policy.auditDenied !== false,
  }
}
