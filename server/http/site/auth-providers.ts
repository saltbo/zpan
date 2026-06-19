import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageSchema } from '@shared/schemas'
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
    clientSecret: z.string().nullable(),
  })
  .openapi('AuthProvider')

const authProviderListSchema = pageSchema(authProviderSchema, 'AuthProviderList')

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

// One auth-providers resource. GET / serves the enabled list without secrets to
// anonymous/login callers, and the full config to admins; writes are admin-only.
export const authProviders = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { items } = await listAuthProviders(c.get('deps'), { isAdmin: c.get('userRole') === 'admin' })
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(upsertRoute, async (c) => {
    const result = await upsertAuthProvider(c.get('deps'), c.req.valid('param').providerId, c.req.valid('json'))
    if (!result.ok) throw result.error
    return c.json(result.config, 200)
  })
  .openapi(deleteProviderRoute, async (c) => {
    const providerId = c.req.valid('param').providerId
    const result = await deleteAuthProvider(c.get('deps'), providerId)
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })
