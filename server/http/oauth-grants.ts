import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  oauthConsentContextSchema,
  oauthConsentResultSchema,
  oauthConsentSubmitSchema,
  oauthGrantListSchema,
} from '@shared/schemas'
import type { Env } from '../middleware/platform'
import { getOAuthConsentContext } from '../usecases/oauth-consent'
import { listOAuthGrants, revokeOAuthGrant } from '../usecases/oauth-grants'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'

const paramsSchema = z.object({ grantId: z.string().min(1) })
const consentContextQuerySchema = z.object({ oauthQuery: z.string().min(1) })

const consentContextRoute = authRoute(
  { scopes: [AuthorizationScope.OAUTH_GRANTS_CREATE] },
  {
    operationId: 'getOAuthConsentContext',
    summary: 'Get pending OAuth consent context',
    tags: ['OAuth Apps'],
    method: 'get',
    path: '/oauth-consent',
    request: { query: consentContextQuerySchema },
    responses: {
      200: jsonContent(oauthConsentContextSchema, 'OAuth consent context'),
      400: errorResponse('Invalid OAuth request'),
      403: errorResponse('Workspace access is required'),
    },
  },
)

const consentSubmitRoute = authRoute(
  { scopes: [AuthorizationScope.OAUTH_GRANTS_CREATE] },
  {
    operationId: 'submitOAuthConsent',
    summary: 'Submit OAuth consent decision',
    tags: ['OAuth Apps'],
    method: 'post',
    path: '/oauth-consent',
    request: jsonBody(oauthConsentSubmitSchema),
    responses: {
      200: jsonContent(oauthConsentResultSchema, 'OAuth consent result'),
      400: errorResponse('Invalid OAuth request'),
      403: errorResponse('Workspace access is required'),
    },
  },
)

const listRoute = authRoute(
  { scopes: [AuthorizationScope.OAUTH_GRANTS_READ] },
  {
    operationId: 'listOAuthGrants',
    summary: 'List OAuth grants',
    tags: ['OAuth Apps'],
    method: 'get',
    path: '/oauth-grants',
    responses: {
      200: jsonContent(oauthGrantListSchema, 'OAuth grants'),
    },
  },
)

const revokeRoute = authRoute(
  { scopes: [AuthorizationScope.OAUTH_GRANTS_DELETE] },
  {
    operationId: 'revokeOAuthGrant',
    summary: 'Revoke an OAuth grant',
    tags: ['OAuth Apps'],
    method: 'delete',
    path: '/oauth-grants/{grantId}',
    request: { params: paramsSchema },
    responses: {
      204: { description: 'Revoked' },
      404: errorResponse('OAuth grant not found'),
    },
  },
)

export const oauthGrants = new OpenAPIHono<Env>()
  .openapi(consentContextRoute, async (c) => {
    const { oauthQuery } = c.req.valid('query')
    const context = await getOAuthConsentContext(c.get('deps'), {
      db: c.get('platform').db,
      userId: c.get('userId')!,
      orgId: c.get('orgId'),
      requestUrl: c.req.url,
      oauthQuery,
    })
    return c.json(context, 200)
  })
  .openapi(consentSubmitRoute, async (c) => {
    const { accept, oauthQuery } = c.req.valid('json')
    await getOAuthConsentContext(c.get('deps'), {
      db: c.get('platform').db,
      userId: c.get('userId')!,
      orgId: c.get('orgId'),
      requestUrl: c.req.url,
      oauthQuery,
    })
    const headers = new Headers(c.req.raw.headers)
    headers.set('content-type', 'application/json')
    headers.delete('content-length')
    const response = await c.get('auth').handler(
      new Request(new URL('/api/auth/oauth2/consent', c.req.url), {
        method: 'POST',
        headers,
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      }),
    )
    const body = await response.json().catch(() => null)
    if (!response.ok) return c.json(body ?? { error: response.statusText }, response.status as 400 | 403)
    return c.json(oauthConsentResultSchema.parse(body), 200)
  })
  .openapi(listRoute, async (c) => {
    const result = await listOAuthGrants(c.get('deps'), c.get('platform').db, { userId: c.get('userId')! })
    return c.json(result, 200)
  })
  .openapi(revokeRoute, async (c) => {
    const { grantId } = c.req.valid('param')
    await revokeOAuthGrant(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      grantId,
    })
    return c.body(null, 204)
  })
