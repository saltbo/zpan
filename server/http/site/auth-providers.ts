import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  deleteAuthProvider,
  listAuthProviders,
  listPublicAuthProviders,
  upsertAuthProvider,
} from '../../usecases/site/auth-provider'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

const maskedProviderConfigSchema = z
  .object({
    providerId: z.string(),
    type: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    enabled: z.boolean(),
    discoveryUrl: z.string().optional(),
    scopes: z.array(z.string()).optional(),
  })
  .openapi('AuthProviderConfig')

const publicProviderSchema = z
  .object({
    providerId: z.string(),
    type: z.string(),
    name: z.string(),
    icon: z.string(),
  })
  .openapi('PublicAuthProvider')

// GET / returns the admin config list (with masked secrets) to admins, or the
// public display list to anonymous/login callers — hence the union.
const authProviderListSchema = pageSchema(
  z.union([maskedProviderConfigSchema, publicProviderSchema]),
  'AuthProviderList',
)

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
    200: jsonContent(maskedProviderConfigSchema, 'Upserted auth provider'),
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
    200: jsonContent(z.object({ providerId: z.string(), deleted: z.literal(true) }), 'Deleted auth provider'),
    400: errorResponse('Invalid provider'),
  },
})

// One auth-providers resource. GET / serves the enabled list without secrets to
// anonymous/login callers, and the full config to admins; writes are admin-only.
export const authProviders = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { items } =
      c.get('userRole') === 'admin'
        ? await listAuthProviders(c.get('deps'))
        : await listPublicAuthProviders(c.get('deps'))
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
    return c.json({ providerId, deleted: true as const }, 200)
  })
