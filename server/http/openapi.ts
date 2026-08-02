import { createRoute, type RouteConfig, type z } from '@hono/zod-openapi'
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

export function authRoute<P extends string, T extends Omit<RouteConfig, 'path'> & { path: P }>(
  auth: RouteAuthorizationDeclaration,
  config: T,
): T & { getRoutingPath(): string } {
  const middleware = [authorize(auth), ...((config.middleware ?? []) as [])]
  return createRoute({
    ...config,
    middleware,
    ...openApiSecurity(auth),
    ...openApiAuthorizationConstraints(auth),
  } as T) as T & { getRoutingPath(): string }
}

export function findOperationsMissingAuthContract(paths: Record<string, Record<string, unknown>>): string[] {
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options'])
  const missing: string[] = []
  for (const [path, operations] of Object.entries(paths)) {
    if (path.startsWith('/api/auth/')) continue
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue
      if (!operation || typeof operation !== 'object') continue
      if (hasValidAuthContract(operation)) continue
      missing.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return missing
}

function openApiAuthorizationConstraints(auth: RouteAuthorizationDeclaration): Record<string, unknown> {
  if ('public' in auth) return {}
  return {
    'x-zpan-authorization-constraints': {
      requiredScopes: [...auth.scopes],
      ...(auth.oauth === false ? { oauth: false } : {}),
      ...(auth.minTeamRole ? { minTeamRole: auth.minTeamRole } : {}),
      ...(auth.siteRole ? { siteRole: auth.siteRole } : {}),
    },
  }
}

function hasValidAuthContract(operation: object): boolean {
  if (!('security' in operation) || !Array.isArray(operation.security)) return false
  if (operation.security.length === 0) return true
  const constraints =
    'x-zpan-authorization-constraints' in operation ? operation['x-zpan-authorization-constraints'] : null
  if (!constraints || typeof constraints !== 'object' || !('requiredScopes' in constraints)) return false
  return Array.isArray(constraints.requiredScopes) && constraints.requiredScopes.length > 0
}

function openApiSecurity(auth: RouteAuthorizationDeclaration): { security?: Record<string, string[]>[] } {
  if ('public' in auth) return { security: [] }
  return { security: openApiPolicySecurity(auth) }
}

function openApiPolicySecurity(policy: ScopedAuthorizationPolicy): Record<string, string[]>[] {
  return [...(policy.oauth === false ? [] : [{ oauth2: [...policy.scopes] }]), { bearerAuth: [] }, { cookieAuth: [] }]
}
