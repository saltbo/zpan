import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { WORKSPACE_AUTHORIZATION_DETAIL_TYPE } from '@shared/oauth'
import { createLocalJWKSet, jwtVerify } from 'jose'
import type { Env } from '../middleware/platform'
import { listOAuthAuthorizationDetailsCatalog } from '../usecases/oauth-authorization-details'
import { unauthorized } from '../usecases/ports'
import { errorResponse, jsonContent } from './openapi'

const catalogEntrySchema = z.object({
  authorizationDetail: z.object({
    type: z.literal(WORKSPACE_AUTHORIZATION_DETAIL_TYPE),
    identifier: z.string().min(1),
  }),
  display: z.object({
    label: z.string(),
    metadata: z.record(z.string(), z.string()),
  }),
})

const catalogSchema = z.object({ items: z.array(catalogEntrySchema) }).openapi('AuthorizationDetailsCatalog')

const catalogRoute = {
  operationId: 'listAuthorizationDetailsCatalog',
  summary: 'List available authorization details',
  description:
    'Lists the workspace authorization details currently available to the connected user. This account-level endpoint accepts the OAuth subject credential and does not grant access to workspace files or data.',
  tags: ['OAuth'],
  method: 'get' as const,
  path: '/',
  security: [{ oauth2: [AuthorizationScope.WORKSPACES_DISCOVER] }],
  responses: {
    200: jsonContent(catalogSchema, 'Available workspace authorization details'),
    401: errorResponse('Invalid or expired account access token'),
    403: errorResponse('Missing workspace discovery scope'),
  },
}

export const oauthAuthorizationDetails = new OpenAPIHono<Env>().openapi(catalogRoute, async (c) => {
  const authorization = c.req.header('Authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : ''
  if (!token) throw unauthorized('Unauthorized')

  const auth = c.get('auth')
  const authContext = await auth.$context
  const items = await listOAuthAuthorizationDetailsCatalog(c.get('deps'), {
    db: c.get('platform').db,
    token,
    verifyJwtToken: async () =>
      (
        await jwtVerify(token, createLocalJWKSet(await auth.api.getJwks()), {
          issuer: authContext.baseURL,
          audience: `${new URL(c.req.url).origin}/api`,
        })
      ).payload,
  })
  c.header('Cache-Control', 'no-store')
  return c.json({ items }, 200)
})
