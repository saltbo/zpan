import { createRoute, type RouteConfig, type z } from '@hono/zod-openapi'
import { errorResponseSchema } from '@shared/schemas'
import { authorize, type RouteAuthorizationDeclaration } from '../middleware/authz'

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
  const middleware =
    auth.access === 'protected' ? [authorize(auth), ...((config.middleware ?? []) as [])] : config.middleware
  return createRoute({
    ...config,
    middleware,
    security: openApiSecurity(auth),
    'x-zpan-auth': openApiAuthMetadata(auth),
  } as T) as T & { getRoutingPath(): string }
}

export function findOperationsMissingAuthContract(paths: Record<string, Record<string, unknown>>): string[] {
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options'])
  const missing: string[] = []
  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!methods.has(method)) continue
      if (!operation || typeof operation !== 'object') continue
      if ('x-zpan-auth' in operation) continue
      missing.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return missing
}

function openApiSecurity(auth: RouteAuthorizationDeclaration): Record<string, string[]>[] {
  if (auth.access === 'anyOf') return auth.policies.flatMap(openApiSecurity)
  if (auth.access === 'public' || auth.access === 'internal' || auth.access === 'signed-webhook') return []
  if (auth.access === 'admin' || auth.access === 'session') return [{ cookieAuth: [] }]
  if (auth.access === 'downloader' || auth.access === 'task-upload-token') return [{ bearerAuth: [] }]
  return auth.scopes?.length
    ? [{ bearerAuth: [...auth.scopes] }, { cookieAuth: [] }]
    : [{ bearerAuth: [] }, { cookieAuth: [] }]
}

function openApiAuthMetadata(auth: RouteAuthorizationDeclaration): Record<string, unknown> {
  if (auth.access === 'anyOf') return { access: auth.access, policies: auth.policies.map(openApiAuthMetadata) }
  if (auth.access === 'session') return { access: auth.access, minTeamRole: auth.minTeamRole ?? null }
  if (auth.access !== 'protected') return { access: auth.access }
  return {
    access: auth.access,
    scopes: auth.scopes ?? [],
    minTeamRole: auth.minTeamRole ?? null,
    allowDownloader: auth.allowDownloader ?? false,
    auditDenied: auth.auditDenied !== false,
  }
}
