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

type OpenApiDocument = {
  components?: {
    headers?: Record<string, unknown>
  }
  paths?: Record<string, Record<string, unknown>>
}

// Request correlation is a framework-level contract: every documented response
// exposes the same support identifier instead of redefining it per endpoint.
export function addRequestIdOpenApi(document: object): void {
  const openApi = document as OpenApiDocument
  openApi.components ??= {}
  openApi.components.headers ??= {}
  openApi.components.headers.RequestId = {
    description: 'Opaque identifier for this request attempt. Provide it when requesting support.',
    schema: { type: 'string', format: 'uuid' },
  }

  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options'])
  for (const pathItem of Object.values(openApi.paths ?? {})) {
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!methods.has(method) || !candidate || typeof candidate !== 'object') continue
      const operation = candidate as { responses?: Record<string, unknown> }
      for (const responseCandidate of Object.values(operation.responses ?? {})) {
        if (!responseCandidate || typeof responseCandidate !== 'object' || '$ref' in responseCandidate) continue
        const response = responseCandidate as { headers?: Record<string, unknown> }
        response.headers ??= {}
        response.headers['Request-Id'] ??= { $ref: '#/components/headers/RequestId' }
      }
    }
  }
}

export function authRoute<P extends string, T extends Omit<RouteConfig, 'path'> & { path: P }>(
  auth: RouteAuthorizationDeclaration,
  config: T,
): T & { getRoutingPath(): string } {
  const middleware = [authorize(auth), ...((config.middleware ?? []) as [])]
  return createRoute({
    ...config,
    middleware,
    ...openApiSecurity(auth),
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

function hasValidAuthContract(operation: object): boolean {
  if (!('security' in operation) || !Array.isArray(operation.security)) return false
  if (operation.security.length === 0) return true

  const requirements = operation.security.filter(
    (requirement): requirement is Record<string, unknown> => !!requirement && typeof requirement === 'object',
  )
  const oauthRequirements = requirements.filter((requirement) => 'oauth2' in requirement)
  if (oauthRequirements.length > 0) {
    return oauthRequirements.some((requirement) => {
      const scopes = requirement.oauth2
      return Array.isArray(scopes) && scopes.length > 0 && scopes.every((scope) => typeof scope === 'string')
    })
  }

  return requirements.some((requirement) => {
    if ('bearerAuth' in requirement && Array.isArray(requirement.bearerAuth)) return true
    if ('cookieAuth' in requirement && Array.isArray(requirement.cookieAuth)) return true
    return false
  })
}

function openApiSecurity(auth: RouteAuthorizationDeclaration): { security?: Record<string, string[]>[] } {
  if ('public' in auth) return { security: [] }
  return { security: openApiPolicySecurity(auth) }
}

function openApiPolicySecurity(policy: ScopedAuthorizationPolicy): Record<string, string[]>[] {
  if (policy.credential === 'downloader') return [{ bearerAuth: [] }]
  return [...(policy.oauth === false ? [] : [{ oauth2: [...policy.scopes] }]), { bearerAuth: [] }, { cookieAuth: [] }]
}
