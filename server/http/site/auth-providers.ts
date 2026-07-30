import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import type { Env } from '../../middleware/platform'
import { deleteAuthProvider, listAuthProviderSettings, upsertAuthProvider } from '../../usecases/site/auth-provider'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

// Full management shape. Public consumers receive the minimal provider projection
// from configz instead.
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
    clientSecret: z.string(),
  })
  .openapi('AuthProvider')

const authProviderListSchema = z
  .object({
    items: z.array(authProviderSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    callbackBaseUri: z.string(),
    registeredApplications: z.array(
      z.object({
        clientId: z.string(),
        name: z.string(),
        uri: z.string().nullable(),
        redirectUris: z.array(z.string()),
        grantTypes: z.array(z.string()),
        scopes: z.array(z.string()),
        disabled: z.boolean(),
        createdAt: z.string(),
      }),
    ),
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

const listRoute = authRoute(
  { scopes: [AuthorizationScope.AUTH_PROVIDERS_READ], siteRole: 'admin' },
  {
    operationId: 'listAuthProviders',
    summary: 'List auth providers',
    tags: ['Auth Providers'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(authProviderListSchema, 'Auth providers') },
  },
)

const upsertRoute = authRoute(
  { scopes: [AuthorizationScope.AUTH_PROVIDERS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'upsertAuthProvider',
    summary: 'Create or update an auth provider',
    tags: ['Auth Providers'],
    method: 'put',
    path: '/{providerId}',
    request: { params: z.object({ providerId: z.string() }), ...jsonBody(upsertSchema) },
    responses: {
      200: jsonContent(authProviderSchema, 'Upserted auth provider'),
      400: errorResponse('Invalid provider'),
      402: errorResponse('Feature not available'),
    },
  },
)

const deleteProviderRoute = authRoute(
  { scopes: [AuthorizationScope.AUTH_PROVIDERS_DELETE], siteRole: 'admin' },
  {
    operationId: 'deleteAuthProvider',
    summary: 'Delete an auth provider',
    tags: ['Auth Providers'],
    method: 'delete',
    path: '/{providerId}',
    request: { params: z.object({ providerId: z.string() }) },
    responses: {
      204: { description: 'Deleted auth provider' },
      400: errorResponse('Invalid provider'),
    },
  },
)

function resolveAuthBaseUri(c: { get(key: 'platform'): Env['Variables']['platform']; req: { url: string } }): string {
  // Prefer the configured Better Auth base URL because OAuth providers validate
  // redirects against the auth runtime base. Fall back to request origin for
  // deployments that rely on per-request Worker/Node origin behavior.
  return c.get('platform').getEnv('BETTER_AUTH_URL')?.trim() || new URL(c.req.url).origin
}

// Auth-provider management resource. Public enabled providers are projected by
// /api/configz; every route here is admin-only.
export const authProviders = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const authOrigin = resolveAuthBaseUri(c)
    const { items, registeredApplications } = await listAuthProviderSettings(c.get('deps'), c.get('platform').db, {
      authOrigin,
    })
    return c.json(
      {
        items,
        total: items.length,
        page: 1,
        pageSize: items.length,
        callbackBaseUri: authOrigin,
        registeredApplications,
      },
      200,
    )
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
