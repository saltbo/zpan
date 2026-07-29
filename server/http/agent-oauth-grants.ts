import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  agentOAuthConsentContextSchema,
  agentOAuthConsentResultSchema,
  agentOAuthConsentSubmitSchema,
  agentOAuthGrantListSchema,
} from '@shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getAgentOAuthConsentContext } from '../usecases/agent-oauth-consent'
import { listAgentOAuthGrants, revokeAgentOAuthGrant } from '../usecases/agent-oauth-grants'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'

const paramsSchema = z.object({ grantId: z.string().min(1) })
const consentContextQuerySchema = z.object({ oauthQuery: z.string().min(1) })

const consentContextRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'getAgentOAuthConsentContext',
    summary: 'Get pending Agent OAuth consent context',
    tags: ['Agent Access'],
    method: 'get',
    path: '/agent-oauth-consent',
    middleware: [requireAuth] as const,
    request: { query: consentContextQuerySchema },
    responses: {
      200: jsonContent(agentOAuthConsentContextSchema, 'Agent OAuth consent context'),
      400: errorResponse('Invalid OAuth request'),
      403: errorResponse('Workspace access is required'),
    },
  },
)

const consentSubmitRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'submitAgentOAuthConsent',
    summary: 'Submit Agent OAuth consent decision',
    tags: ['Agent Access'],
    method: 'post',
    path: '/agent-oauth-consent',
    middleware: [requireAuth] as const,
    request: jsonBody(agentOAuthConsentSubmitSchema),
    responses: {
      200: jsonContent(agentOAuthConsentResultSchema, 'Agent OAuth consent result'),
      400: errorResponse('Invalid OAuth request'),
      403: errorResponse('Workspace access is required'),
    },
  },
)

const listRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'listAgentOAuthGrants',
    summary: 'List Agent OAuth grants',
    tags: ['Agent Access'],
    method: 'get',
    path: '/agent-oauth-grants',
    middleware: [requireAuth] as const,
    responses: {
      200: jsonContent(agentOAuthGrantListSchema, 'Agent OAuth grants'),
    },
  },
)

const revokeRoute = authRoute(
  { access: 'session' },
  {
    operationId: 'revokeAgentOAuthGrant',
    summary: 'Revoke an Agent OAuth grant',
    tags: ['Agent Access'],
    method: 'delete',
    path: '/agent-oauth-grants/{grantId}',
    middleware: [requireAuth] as const,
    request: { params: paramsSchema },
    responses: {
      204: { description: 'Revoked' },
      404: errorResponse('Agent OAuth grant not found'),
    },
  },
)

export const agentOAuthGrants = new OpenAPIHono<Env>()
  .openapi(consentContextRoute, async (c) => {
    const { oauthQuery } = c.req.valid('query')
    const context = await getAgentOAuthConsentContext(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId'),
      requestUrl: c.req.url,
      oauthQuery,
    })
    return c.json(context, 200)
  })
  .openapi(consentSubmitRoute, async (c) => {
    const { accept, oauthQuery } = c.req.valid('json')
    await getAgentOAuthConsentContext(c.get('deps'), {
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
    return c.json(agentOAuthConsentResultSchema.parse(body), 200)
  })
  .openapi(listRoute, async (c) => {
    const result = await listAgentOAuthGrants(c.get('deps'), c.get('platform').db, { userId: c.get('userId')! })
    return c.json(result, 200)
  })
  .openapi(revokeRoute, async (c) => {
    const { grantId } = c.req.valid('param')
    await revokeAgentOAuthGrant(c.get('deps'), c.get('platform').db, {
      userId: c.get('userId')!,
      grantId,
    })
    return c.body(null, 204)
  })
