import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { deleteAuthProvider, listAuthProviders, upsertAuthProvider } from '../../usecases/site/auth-provider'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

// One monomorphic schema for every caller. Role changes values only — admin gets a
// masked `clientSecret`, front-of-house gets `clientSecret: null` (and the enabled-only
// list). clientId/discoveryUrl/scopes are not secrets, so they are exposed to everyone.
const authProviderSchema = z
  .object({
    providerId: z.string(),
    type: z.string(),
    enabled: z.boolean(),
    name: z.string(),
    icon: z.string(),
    clientId: z.string(),
    discoveryUrl: z.string().nullable(),
    scopes: z.array(z.string()).nullable(),
    callbackUri: z.string(),
    clientSecret: z.string().nullable(),
  })
  .openapi('AuthProvider')

const authProviderListSchema = z
  .object({
    items: z.array(authProviderSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    callbackBaseUri: z.string(),
  })
  .openapi('AuthProviderList')

const upsertSchema = z.object({
  type: z.enum(['builtin', 'oidc']),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  enabled: z.boolean(),
  discoveryUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
})

const listRoute = createRoute({
  operationId: 'listAuthProviders',
  summary: 'List auth providers',
  tags: ['Auth Providers'],
  method: 'get',
  path: '/',
  responses: { 200: jsonContent(authProviderListSchema, 'Auth providers') },
})

const upsertRoute = createRoute({
  operationId: 'upsertAuthProvider',
  summary: 'Create or update an auth provider',
  tags: ['Auth Providers'],
  method: 'put',
  path: '/{providerId}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ providerId: z.string() }), ...jsonBody(upsertSchema) },
  responses: {
    200: jsonContent(authProviderSchema, 'Upserted auth provider'),
    400: errorResponse('Invalid provider'),
    402: errorResponse('Feature not available'),
  },
})

const deleteProviderRoute = createRoute({
  operationId: 'deleteAuthProvider',
  summary: 'Delete an auth provider',
  tags: ['Auth Providers'],
  method: 'delete',
  path: '/{providerId}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ providerId: z.string() }) },
  responses: {
    204: { description: 'Deleted auth provider' },
    400: errorResponse('Invalid provider'),
  },
})

function resolveAuthBaseUri(c: { get(key: 'platform'): Env['Variables']['platform']; req: { url: string } }): string {
  // Prefer the configured Better Auth base URL because OAuth providers validate
  // redirects against the auth runtime base. Fall back to request origin for
  // deployments that rely on per-request Worker/Node origin behavior.
  return c.get('platform').getEnv('BETTER_AUTH_URL')?.trim() || new URL(c.req.url).origin
}

// One auth-providers resource. GET / serves the enabled list without secrets to
// anonymous/login callers, and the full config to admins; writes are admin-only.
export const authProviders = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const authOrigin = resolveAuthBaseUri(c)
    const { items } = await listAuthProviders(c.get('deps'), { isAdmin: c.get('userRole') === 'admin', authOrigin })
    return c.json({ items, total: items.length, page: 1, pageSize: items.length, callbackBaseUri: authOrigin }, 200)
  })
  .openapi(upsertRoute, async (c) => {
    const authOrigin = resolveAuthBaseUri(c)
    const result = await upsertAuthProvider(c.get('deps'), c.req.valid('param').providerId, c.req.valid('json'), {
      authOrigin,
    })
    if (!result.ok) throw result.error
    return c.json(result.config, 200)
  })
  .openapi(deleteProviderRoute, async (c) => {
    const providerId = c.req.valid('param').providerId
    const result = await deleteAuthProvider(c.get('deps'), providerId)
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })
